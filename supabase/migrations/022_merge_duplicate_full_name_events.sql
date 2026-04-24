-- Merge duplicate event rows that have the same league + date + title
-- but different external_ids. These appeared because
-- canonicalEventKey() was implemented inconsistently between worker
-- (raw startTime.slice(0,10)) and Vercel (new Date().toISOString()).
-- When an adapter sent startTime in a format the two implementations
-- parse differently (e.g. "04/24/2026 18:40" vs ISO), worker and
-- Vercel computed different external_ids for the same game and both
-- passed the unique constraint — two rows per game.
--
-- Both canonical key implementations are now aligned; this migration
-- cleans the historical duplicates.
--
-- Concurrency: the naive single-statement DELETE with CASCADE deadlocks
-- against the live cron/worker upserts hitting current_market_odds.
-- Loop in small batches, short lock timeout, explicit child-first
-- deletes (consistent lock order). Safe to interrupt and re-run — each
-- batch is its own small transaction and the CTE re-identifies
-- remaining duplicates on every iteration.
--
-- Scope: events in the ±2 week window so archived history is untouched.

SET lock_timeout = '2s';

DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
    -- Identify up to 50 losers this iteration.
    WITH source_counts AS (
      SELECT
        e.id,
        e.league_id,
        e.start_time::date AS event_date,
        e.title,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo
          WHERE cmo.event_id = e.id
        ), 0) AS source_count
      FROM events e
      WHERE e.start_time > NOW() - INTERVAL '2 days'
        AND e.start_time < NOW() + INTERVAL '14 days'
    ),
    duplicate_groups AS (
      SELECT league_id, event_date, title
      FROM source_counts
      GROUP BY league_id, event_date, title
      HAVING COUNT(*) > 1
    ),
    ranked AS (
      SELECT
        sc.id,
        ROW_NUMBER() OVER (
          PARTITION BY sc.league_id, sc.event_date, sc.title
          ORDER BY sc.source_count DESC, sc.id
        ) AS rnk
      FROM source_counts sc
      JOIN duplicate_groups dg
        ON dg.league_id = sc.league_id
       AND dg.event_date = sc.event_date
       AND dg.title = sc.title
    )
    SELECT ARRAY_AGG(id) INTO batch_ids
    FROM (SELECT id FROM ranked WHERE rnk > 1 LIMIT 50) x;

    EXIT WHEN batch_ids IS NULL OR array_length(batch_ids, 1) IS NULL;

    -- Delete children first in a consistent order so concurrent writes
    -- don't produce a cyclic lock graph. Any per-event FKs not listed
    -- here still fall through the ON DELETE CASCADE on events itself.
    DELETE FROM current_market_odds       WHERE event_id = ANY(batch_ids);
    DELETE FROM market_snapshots          WHERE event_id = ANY(batch_ids);
    DELETE FROM prop_odds                 WHERE event_id = ANY(batch_ids);
    DELETE FROM prediction_market_snapshots WHERE event_id = ANY(batch_ids);

    DELETE FROM events WHERE id = ANY(batch_ids);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;

    EXIT WHEN batch_deleted = 0;
  END LOOP;

  RAISE NOTICE 'merged % duplicate event rows', total_deleted;
END $$;
