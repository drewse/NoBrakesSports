-- Cleanup for two leftover patterns on MLB Markets:
--
-- 1. Oakland Athletics → Athletics rebrand. Same pattern as 025 for
--    Utah Hockey Club → Utah Mammoth. Some sources still ship the old
--    "Oakland Athletics" name, others use the new "Athletics". The
--    canonical code now collapses both, but pre-fix DB rows have
--    different external_ids and different titles.
--
-- 2. Stale wrong-title orphans like "Chicago White vs Sox Washington
--    Nationals" (1 source, hour-old) sitting next to the real
--    "Chicago White Sox vs Washington Nationals" (12 sources, fresh).
--    Same for "Kansas City Royals vs Los Angeles Dodgers" (wrong
--    opponent) vs "Kansas City Royals vs Los Angeles Angels". These
--    have <= 2 sources and stopped receiving writes >30 min ago.
--    They're residue from the pre-alias-fix era; no current adapter
--    writes them anymore.
--
-- Batched, child-first deletes, lock_timeout = 2s. Safe to re-run.

SET lock_timeout = '2s';

-- Part 1: Athletics rebrand — pair any "X vs Oakland Athletics" or
-- "Sacramento Athletics vs X" with its "X vs Athletics" counterpart
-- on the same league + date, and delete the old-named row.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
    SELECT ARRAY_AGG(old.id) INTO batch_ids
    FROM (
      SELECT e.id, e.league_id, e.start_time::date AS d, e.title
      FROM events e
      WHERE (
        e.title ILIKE '%Oakland Athletics%'
        OR e.title ILIKE '%Sacramento Athletics%'
      )
    ) old
    WHERE EXISTS (
      SELECT 1 FROM events e2
      WHERE e2.id <> old.id
        AND e2.league_id = old.league_id
        AND e2.start_time::date = old.d
        AND e2.title ILIKE '% Athletics%'
        AND e2.title NOT ILIKE '%Oakland%'
        AND e2.title NOT ILIKE '%Sacramento%'
        AND REPLACE(REPLACE(REPLACE(REPLACE(LOWER(e2.title),
              'athletics', ''), 'vs', ''), '  ', ' '), '  ', ' ') =
            REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(old.title),
              'oakland athletics', ''), 'sacramento athletics', ''),
              'athletics', ''), 'vs', ''), '  ', ' '), '  ', ' ')
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
  RAISE NOTICE 'merged % Athletics rebrand duplicates', total_deleted;
END $$;

-- Part 2: stale orphan events — upcoming events with <=2 sources and
-- no write in the last 30 min, where ANOTHER event on the same
-- league+date has >=5 sources and recent activity. These are
-- abandoned pre-fix rows that the UI keeps showing.
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
    SELECT ARRAY_AGG(orphan.id) INTO batch_ids
    FROM (
      SELECT
        e.id,
        e.league_id,
        e.start_time::date AS d,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ), 0) AS src_count,
        (
          SELECT MAX(snapshot_time)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ) AS last_update
      FROM events e
      WHERE e.start_time > NOW() - INTERVAL '1 day'
        AND e.start_time < NOW() + INTERVAL '7 days'
    ) orphan
    WHERE orphan.src_count <= 2
      AND (orphan.last_update IS NULL OR orphan.last_update < NOW() - INTERVAL '30 minutes')
      AND EXISTS (
        SELECT 1 FROM events e2
        WHERE e2.id <> orphan.id
          AND e2.league_id = orphan.league_id
          AND e2.start_time::date = orphan.d
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
  RAISE NOTICE 'removed % stale orphan events', total_deleted;
END $$;
