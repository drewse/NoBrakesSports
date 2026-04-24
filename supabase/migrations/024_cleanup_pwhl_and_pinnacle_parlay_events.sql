-- Cleanup of two classes of junk events visible on the NHL Markets
-- page:
--
-- 1. Pinnacle daily-parlay placeholder events with team names like
--    "Home Goals (3 Games)" vs "Away Goals (3 Games)". Pinnacle
--    exposes these as real matchups under their sports/hockey tree;
--    our adapter now filters them out (isPlaceholderTeam check in
--    pinnacle.ts) but existing rows need to be removed.
--
-- 2. PWHL (Professional Women's Hockey League) games that FanDuel's
--    NHL page bundles in with actual NHL. Boston Fleet, New York
--    Sirens, Ottawa Charge, Toronto Sceptres, Minnesota Frost,
--    Montreal Victoire. The adapter now skips these (PWHL_TEAMS
--    blocklist in fanduel-props.ts) but existing rows remain.
--
-- Batched deletion with child-first order so cascade locks don't
-- contend with live upserts. Safe to re-run.

SET lock_timeout = '2s';

DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
    SELECT ARRAY_AGG(id) INTO batch_ids
    FROM (
      SELECT e.id
      FROM events e
      WHERE
        -- Pinnacle parlay placeholders: "(N Games)" in the title
        e.title ~ '\(\d+\s*Games?\)'
        -- OR "Home Goals" / "Away Goals" / "Home Teams" / "Away Teams" etc.
        OR e.title ~* '^(home|away)\s+(teams?|goals?|runs?|points?)\s'
        -- OR PWHL teams on the NHL league
        OR (
          e.league_id IN (SELECT id FROM leagues WHERE slug = 'nhl')
          AND (
            e.title ILIKE '%Boston Fleet%'
            OR e.title ILIKE '%Minnesota Frost%'
            OR e.title ILIKE '%Montreal Victoire%'
            OR e.title ILIKE '%New York Sirens%'
            OR e.title ILIKE '%Ottawa Charge%'
            OR e.title ILIKE '%Toronto Sceptres%'
          )
        )
      LIMIT 50
    ) x;

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

  RAISE NOTICE 'removed % PWHL / Pinnacle-placeholder events', total_deleted;
END $$;
