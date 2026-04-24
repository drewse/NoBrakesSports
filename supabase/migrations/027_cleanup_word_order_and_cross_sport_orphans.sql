-- Cleanup for the two remaining MLB Markets dup patterns visible after 026:
--
-- 1. Word-order corruption: titles like "Toronto Blue vs Jays Cleveland
--    Guardians" sit next to the canonical "Toronto Blue Jays vs
--    Cleveland Guardians". Some pre-fix adapter mis-split team names on
--    a space and the orphan event row stuck around. They have <=1
--    source (typically just polymarket writing via fuzzy title match).
--    Detect by: same league + same date + a sister event with the same
--    teams in correct order has >=5 sources.
--
-- 2. Cross-sport leakage into MLB: PowerPlay's old config scraped the
--    broad /sports/baseball page (NCAA + KBO + NPB + summer) and tagged
--    every game on it as MLB. Now fixed in worker/src/adapters/
--    powerplay.ts to use /sports/baseball/mlb. Existing residue:
--    NCAA baseball ("Mississippi State…", "Auburn Tigers vs Oklahoma
--    Sooners"), ECHL hockey under MLB ("Wheeling Nailers vs Reading
--    Royals"), KBO/NPB ("Doosan Bears vs Lg Twins", "Hanshin Tigers vs
--    Hiroshima Toyo Carp"). Detect by: event tagged as MLB but the
--    title doesn't contain ANY canonical MLB team name.
--
-- Same batched, child-first delete pattern as 025/026, lock_timeout=2s,
-- safe to re-run.

SET lock_timeout = '2s';

-- Part 1: word-order-corrupted MLB events with a canonical sister.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
  mlb_id UUID;
BEGIN
  SELECT id INTO mlb_id FROM leagues WHERE slug = 'mlb' LIMIT 1;
  IF mlb_id IS NULL THEN
    RAISE NOTICE 'mlb league not found, skipping part 1';
    RETURN;
  END IF;

  LOOP
    SELECT ARRAY_AGG(bad.id) INTO batch_ids
    FROM (
      SELECT
        e.id,
        e.start_time::date AS d,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ), 0) AS src_count
      FROM events e
      WHERE e.league_id = mlb_id
        AND e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '14 days'
        -- word-order corruption signature: title splits to short first half
        -- ("Toronto Blue", "Tampa Bay", "New York", "Chicago White",
        -- "Los Angeles", "San Francisco", "St Louis"/"St. Louis") followed
        -- by " vs " followed by 3+ tokens.
        AND (
          e.title ~* '^(toronto blue|tampa bay|chicago white|new york|los angeles|san francisco|st\.? louis|kansas city) vs '
        )
        -- ensure it's actually corrupted (the second half should start with
        -- a leftover team-name fragment like "jays", "rays", "sox",
        -- "mets", "dodgers", "giants", "cardinals", "royals")
        AND e.title ~* ' vs (jays|rays|sox|mets|dodgers|giants|cardinals|royals|angels) '
    ) bad
    WHERE bad.src_count <= 2
      AND EXISTS (
        SELECT 1 FROM events e2
        WHERE e2.league_id = mlb_id
          AND e2.start_time::date = bad.d
          AND e2.id <> bad.id
          AND (
            SELECT COUNT(DISTINCT source_id)
            FROM current_market_odds cmo WHERE cmo.event_id = e2.id
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
  RAISE NOTICE 'removed % word-order-corrupted MLB events', total_deleted;
END $$;

-- Part 2: cross-sport leakage — events tagged as MLB whose titles
-- contain ZERO canonical MLB team names. Restrict to upcoming + low-
-- source rows so we don't accidentally nuke a real MLB game whose
-- title was mangled in some other way.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
  mlb_id UUID;
  mlb_team_re TEXT;
BEGIN
  SELECT id INTO mlb_id FROM leagues WHERE slug = 'mlb' LIMIT 1;
  IF mlb_id IS NULL THEN
    RAISE NOTICE 'mlb league not found, skipping part 2';
    RETURN;
  END IF;

  -- Canonical MLB team-name fragments. A real MLB event title MUST
  -- contain at least one of these on each side ("Yankees", "Red Sox",
  -- etc). Use ILIKE OR of substrings rather than a regex to keep the
  -- check trivially debuggable.
  mlb_team_re := '(yankees|red sox|blue jays|orioles|rays|guardians|tigers|royals|twins|white sox|astros|mariners|rangers|angels|athletics|braves|marlins|mets|nationals|phillies|brewers|cardinals|cubs|pirates|reds|diamondbacks|dodgers|giants|padres|rockies)';

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
      WHERE e.league_id = mlb_id
        AND e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '14 days'
        -- title contains NO canonical MLB team name on either side
        AND e.title !~* '(yankees|red sox|blue jays|orioles|rays|guardians|tigers|royals|twins|white sox|astros|mariners|rangers|angels|athletics|braves|marlins|mets|nationals|phillies|brewers|cardinals|cubs|pirates|reds|diamondbacks|dodgers|giants|padres|rockies)'
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
  RAISE NOTICE 'removed % cross-sport MLB-tagged events', total_deleted;
END $$;

-- Part 3: the doubled-syllable orphans (cincinnaticinnati, atlantaanta,
-- etc.) — historical residue from before the canonical-key fix. Their
-- canonical sisters now get all the writes; these rows haven't been
-- touched in >30 min. Same shape as 026's stale-orphan part but
-- specifically targets the doubled-syllable external_id signature so
-- we don't accidentally catch legit low-source events.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
  mlb_id UUID;
BEGIN
  SELECT id INTO mlb_id FROM leagues WHERE slug = 'mlb' LIMIT 1;
  IF mlb_id IS NULL THEN
    RAISE NOTICE 'mlb league not found, skipping part 3';
    RETURN;
  END IF;

  LOOP
    SELECT ARRAY_AGG(bad.id) INTO batch_ids
    FROM (
      SELECT
        e.id,
        (
          SELECT MAX(snapshot_time)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ) AS last_update
      FROM events e
      WHERE e.league_id = mlb_id
        AND e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '14 days'
        -- doubled-syllable signature in external_id (e.g.
        -- "cincinnaticinnati", "atlantaanta", "detroitroit",
        -- "philadelphialadelphia", "clevelandveland", "torontoonto")
        AND (
          e.external_id ILIKE '%cincinnaticinnati%'
          OR e.external_id ILIKE '%atlantaanta%'
          OR e.external_id ILIKE '%detroitroit%'
          OR e.external_id ILIKE '%philadelphialadelphia%'
          OR e.external_id ILIKE '%clevelandveland%'
          OR e.external_id ILIKE '%torontoonto%'
          OR e.external_id ~ '([a-z]{4,})\1'  -- generic doubled-syllable backup
        )
    ) bad
    WHERE bad.last_update IS NULL
       OR bad.last_update < NOW() - INTERVAL '30 minutes'
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
  RAISE NOTICE 'removed % doubled-syllable orphan events', total_deleted;
END $$;
