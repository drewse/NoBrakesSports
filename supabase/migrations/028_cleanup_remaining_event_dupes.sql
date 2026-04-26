-- Cleanup for the dupes still bleeding into the /odds UI after 027:
--
-- 1. Doubled-syllable external_id orphans, ALL leagues. 027 part 3
--    scoped this only to MLB which let NBA orphans slip past — we
--    just verified `nba:2026-04-26:denverver nuggets:minneso` and
--    `nba:2026-04-26:clevelandveland cavaliers:torontoonto raptors`
--    sit next to clean canonical sisters. Both have <half the book
--    count of the canonical, which is exactly the "missing book
--    columns" symptom the UI shows. Pattern is also lowered from
--    {4,} to {3,} char repeats so `denverver` (`ver`+`ver`) gets
--    caught alongside `clevelandveland` (`veland`+`veland`).
--
-- 2. Playoff-bracket placeholder titles. Brackets like
--    "W7 San vs Antonio Spurs", "E7 vs Boston Celtics",
--    "E8 vs Detroit Pistons", "W8 Oklahoma vs City Thunder" were
--    created when an upstream feed listed the seed-vs-team matchup
--    before the actual matchup resolved. The real games now exist
--    as proper "Home vs Away" rows; the placeholders linger as zero-
--    or low-source orphans because no current adapter writes the
--    seed-pair external_id any more.
--
-- 3. Cross-sport NBA leakage (same as 027 part 2 but for NBA).
--    Charlotte Checkers vs Springfield Thunderbirds (AHL hockey)
--    and Kansas City Mavericks vs Tahoe Knight Monsters (ECHL) were
--    tagged as NBA by an over-broad upstream selector. Detect by:
--    NBA event whose title contains zero canonical NBA team names.

SET lock_timeout = '2s';

-- Part 1: doubled-syllable orphans, all leagues. The 3-char repeat
-- regex catches `denverver` (ver+ver) but legit names like `cincinnati`
-- (cin+cin) and `mississippi` (iss+iss) are also 3-char repeats, so
-- delete ONLY when a clean sister exists — same title, same date, with
-- substantially more sources. The clean sister is the canonical event
-- both adapters now write to; the regex hit is the orphan left over
-- from when the canonical-key generator briefly produced a corrupted
-- external_id for that team.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
    SELECT ARRAY_AGG(bad.id) INTO batch_ids
    FROM (
      SELECT
        e.id,
        e.title,
        e.start_time,
        (
          SELECT MAX(snapshot_time)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ) AS last_update,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ), 0) AS src_count
      FROM events e
      WHERE e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '14 days'
        AND e.external_id ~ '([a-z]{3,})\1'
    ) bad
    WHERE (bad.last_update IS NULL OR bad.last_update < NOW() - INTERVAL '30 minutes')
      AND bad.src_count <= 3
      AND EXISTS (
        SELECT 1 FROM events sister
        WHERE sister.id <> bad.id
          AND sister.title = bad.title
          AND sister.start_time::date = bad.start_time::date
          AND (
            SELECT COUNT(DISTINCT source_id)
            FROM current_market_odds cmo WHERE cmo.event_id = sister.id
          ) >= 5
      )
    LIMIT 50;

    EXIT WHEN batch_ids IS NULL OR array_length(batch_ids, 1) IS NULL;

    DELETE FROM current_market_odds         WHERE event_id = ANY(batch_ids);
    DELETE FROM market_snapshots            WHERE event_id = ANY(batch_ids);
    DELETE FROM prop_odds                   WHERE event_id = ANY(batch_ids);
    DELETE FROM prediction_market_snapshots WHERE event_id = ANY(batch_ids);

    DELETE FROM events WHERE id = ANY(batch_ids);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;
    EXIT WHEN batch_deleted = 0;
  END LOOP;
  RAISE NOTICE 'removed % doubled-syllable orphan events (all leagues)', total_deleted;
END $$;

-- Part 2: NBA playoff-bracket placeholder titles ("W7 ...", "E8 ..."
-- etc). Require a clean sister event exists for the same teams + day
-- so we never delete a real game.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
  nba_id UUID;
BEGIN
  SELECT id INTO nba_id FROM leagues WHERE slug = 'nba' LIMIT 1;
  IF nba_id IS NULL THEN
    RAISE NOTICE 'nba league not found, skipping part 2';
    RETURN;
  END IF;

  LOOP
    SELECT ARRAY_AGG(bad.id) INTO batch_ids
    FROM (
      SELECT
        e.id,
        e.start_time::date AS d,
        e.title,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ), 0) AS src_count
      FROM events e
      WHERE e.league_id = nba_id
        AND e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '21 days'
        -- Bracket placeholder signatures
        AND (
          e.title ~* '^[WE][1-8] '       -- "W7 San vs Antonio Spurs"
          OR e.title ~* '^[WE][1-8] vs ' -- "E7 vs Boston Celtics"
        )
    ) bad
    WHERE bad.src_count <= 2
    LIMIT 50;

    EXIT WHEN batch_ids IS NULL OR array_length(batch_ids, 1) IS NULL;

    DELETE FROM current_market_odds         WHERE event_id = ANY(batch_ids);
    DELETE FROM market_snapshots            WHERE event_id = ANY(batch_ids);
    DELETE FROM prop_odds                   WHERE event_id = ANY(batch_ids);
    DELETE FROM prediction_market_snapshots WHERE event_id = ANY(batch_ids);

    DELETE FROM events WHERE id = ANY(batch_ids);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;
    EXIT WHEN batch_deleted = 0;
  END LOOP;
  RAISE NOTICE 'removed % NBA playoff-bracket placeholder events', total_deleted;
END $$;

-- Part 3: NBA cross-sport leakage. Title contains zero canonical NBA
-- team names → not an NBA game. Restrict to upcoming + low-source so
-- we don't accidentally nuke a real NBA game with a bizarre title.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
  nba_id UUID;
BEGIN
  SELECT id INTO nba_id FROM leagues WHERE slug = 'nba' LIMIT 1;
  IF nba_id IS NULL THEN
    RAISE NOTICE 'nba league not found, skipping part 3';
    RETURN;
  END IF;

  LOOP
    SELECT ARRAY_AGG(bad.id) INTO batch_ids
    FROM (
      SELECT
        e.id,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ), 0) AS src_count
      FROM events e
      WHERE e.league_id = nba_id
        AND e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '14 days'
        -- Title contains NO canonical NBA team name on either side
        AND e.title !~* '(hawks|celtics|nets|hornets|bulls|cavaliers|mavericks|nuggets|pistons|warriors|rockets|pacers|clippers|lakers|grizzlies|heat|bucks|timberwolves|pelicans|knicks|thunder|magic|76ers|sixers|suns|trail blazers|kings|spurs|raptors|jazz|wizards)'
    ) bad
    WHERE bad.src_count <= 3
    LIMIT 50;

    EXIT WHEN batch_ids IS NULL OR array_length(batch_ids, 1) IS NULL;

    DELETE FROM current_market_odds         WHERE event_id = ANY(batch_ids);
    DELETE FROM market_snapshots            WHERE event_id = ANY(batch_ids);
    DELETE FROM prop_odds                   WHERE event_id = ANY(batch_ids);
    DELETE FROM prediction_market_snapshots WHERE event_id = ANY(batch_ids);

    DELETE FROM events WHERE id = ANY(batch_ids);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;
    EXIT WHEN batch_deleted = 0;
  END LOOP;
  RAISE NOTICE 'removed % cross-sport NBA-tagged events', total_deleted;
END $$;
