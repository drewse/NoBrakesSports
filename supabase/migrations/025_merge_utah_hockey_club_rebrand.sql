-- Utah rebranded "Utah Hockey Club" → "Utah Mammoth" for 2025-26.
-- Some sources adopted the new name immediately, others lagged; each
-- ended up creating its own event row with a different external_id.
-- The canonical code now aliases both to the same normalized team
-- name, so new writes converge — but pre-fix events still exist as
-- separate rows with mismatched titles. migration 023 dedupes by
-- exact title match so it doesn't catch these.
--
-- Strategy:
--   1. Find every pair where one event's title contains "Utah
--      Hockey Club" and another's title contains "Utah Mammoth"
--      against the SAME opponent on the SAME date.
--   2. Keep the Mammoth row (post-rebrand canonical). Cascade-delete
--      the Hockey Club row's children, then the row itself.
--
-- Batched / interruptible, same pattern as 023/024. Safe to re-run.

SET lock_timeout = '2s';

DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
    SELECT ARRAY_AGG(hcc.id) INTO batch_ids
    FROM (
      -- Rows where team name is "Utah Hockey Club"
      SELECT e.id, e.league_id, e.start_time::date AS d, e.title
      FROM events e
      WHERE e.title ILIKE '%Utah Hockey Club%'
    ) hcc
    WHERE EXISTS (
      -- ...and a matching "Utah Mammoth" row exists for the same
      -- opponent on the same date (opponent = the title part that
      -- isn't "Utah Hockey Club" / "Utah Mammoth").
      SELECT 1 FROM events e2
      WHERE e2.id <> hcc.id
        AND e2.league_id = hcc.league_id
        AND e2.start_time::date = hcc.d
        AND e2.title ILIKE '%Utah Mammoth%'
        AND REPLACE(REPLACE(LOWER(e2.title), 'utah mammoth', ''), 'vs', '') =
            REPLACE(REPLACE(LOWER(hcc.title), 'utah hockey club', ''), 'vs', '')
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

  RAISE NOTICE 'merged % Utah Hockey Club → Utah Mammoth rebrand duplicates', total_deleted;
END $$;
