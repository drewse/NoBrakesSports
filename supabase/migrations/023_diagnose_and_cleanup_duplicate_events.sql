-- Duplicate event cleanup (round 2). Migration 022 merged the
-- historical duplicates, but new ones keep appearing on Markets —
-- meaning some adapter is still producing a canonical key that
-- diverges from every other adapter's key for the same game, so the
-- new event passes the UNIQUE constraint instead of merging.
--
-- This migration does two things:
--   1. Prints a diagnostic list of current duplicate pairs (league,
--      date, title, plus every row's external_id / source count /
--      start_time). When we can see the two external_id strings
--      side-by-side for the same game, the diverging normalization
--      becomes obvious (different date, different team-name form,
--      etc.) and we can patch the adapter.
--   2. Re-runs the 022 merge logic — same batched loop, same
--      child-first delete order, same lock_timeout.
--
-- Safe to re-run. Idempotent. Interruptible (each batch is its own
-- small transaction).

SET lock_timeout = '2s';

-- 1. Diagnostic snapshot — surfaces in the SQL editor output so we
-- can see exactly which pairs are diverging before the delete runs.
DO $$
DECLARE
  r RECORD;
BEGIN
  RAISE NOTICE '=== current duplicate event pairs ===';
  FOR r IN
    WITH src_counts AS (
      SELECT
        e.id,
        e.title,
        e.start_time,
        e.external_id,
        e.league_id,
        e.start_time::date AS d,
        COALESCE((
          SELECT COUNT(DISTINCT source_id)
          FROM current_market_odds cmo WHERE cmo.event_id = e.id
        ), 0) AS src_count
      FROM events e
      WHERE e.start_time > NOW() - INTERVAL '2 days'
        AND e.start_time < NOW() + INTERVAL '14 days'
    )
    SELECT sc.league_id, sc.d, sc.title, sc.id,
           sc.external_id, sc.start_time, sc.src_count
    FROM src_counts sc
    WHERE (sc.league_id, sc.d, sc.title) IN (
      SELECT league_id, d, title
      FROM src_counts
      GROUP BY league_id, d, title
      HAVING COUNT(*) > 1
    )
    ORDER BY sc.title, sc.src_count DESC
  LOOP
    RAISE NOTICE 'dup: % | % | ext=% | start=% | sources=%',
      r.title, r.d, r.external_id, r.start_time, r.src_count;
  END LOOP;
END $$;

-- 2. Batched merge (same logic as 022).
DO $$
DECLARE
  batch_ids UUID[];
  total_deleted INT := 0;
  batch_deleted INT;
BEGIN
  LOOP
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
      SELECT sc.id,
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

    DELETE FROM current_market_odds         WHERE event_id = ANY(batch_ids);
    DELETE FROM market_snapshots            WHERE event_id = ANY(batch_ids);
    DELETE FROM prop_odds                   WHERE event_id = ANY(batch_ids);
    DELETE FROM prediction_market_snapshots WHERE event_id = ANY(batch_ids);

    DELETE FROM events WHERE id = ANY(batch_ids);
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;
    EXIT WHEN batch_deleted = 0;
  END LOOP;
  RAISE NOTICE 'merged % duplicate event rows', total_deleted;
END $$;
