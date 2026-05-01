-- ============================================================
-- Verification queries for migration 031 / scripts/031_concurrent
-- ============================================================
--
-- Run these in the Supabase SQL editor to:
--   1. confirm the new composite indexes exist + are VALID
--   2. measure table sizes (so you can decide if CONCURRENTLY is needed)
--   3. EXPLAIN ANALYZE the hot loader queries to confirm the planner
--      actually picks the new composites
--
-- Expected indexes after migration 031 / scripts/031_concurrent:
--   prop_odds            : po_event_time_idx, po_snapshot_time_idx
--   current_market_odds  : cmo_event_time_idx, cmo_event_market_time_idx, cmo_snapshot_time_idx

-- ── 1. Index existence + validity ────────────────────────────────
SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready
FROM pg_indexes  AS pi
JOIN pg_class    AS c ON c.relname = pi.indexname
JOIN pg_index    AS i ON i.indexrelid = c.oid
WHERE indexname IN (
  'po_event_time_idx',
  'po_snapshot_time_idx',
  'cmo_event_time_idx',
  'cmo_event_market_time_idx',
  'cmo_snapshot_time_idx'
)
ORDER BY tablename, indexname;
-- All rows should show is_valid = true, is_ready = true.

-- ── 2. Table sizes (decides whether CONCURRENTLY is needed) ──────
SELECT
  relname                                       AS table_name,
  n_live_tup                                    AS approx_rows,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
  pg_size_pretty(pg_relation_size(c.oid))       AS heap_size,
  pg_size_pretty(pg_indexes_size(c.oid))        AS indexes_size
FROM pg_stat_user_tables s
JOIN pg_class            c ON c.relname = s.relname
WHERE s.relname IN ('prop_odds', 'current_market_odds', 'events')
ORDER BY relname;
-- Rule of thumb:
--   < 100k rows  → migration 031 (locking) is fine, build is sub-second
--   100k - 1M    → CONCURRENTLY recommended
--   > 1M         → CONCURRENTLY required; expect minutes

-- ── 3. Index usage stats (post-deploy sanity check) ──────────────
SELECT
  relname                AS table_name,
  indexrelname           AS index_name,
  idx_scan               AS times_used,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE relname IN ('prop_odds', 'current_market_odds')
  AND indexrelname IN (
    'po_event_time_idx',
    'po_snapshot_time_idx',
    'cmo_event_time_idx',
    'cmo_event_market_time_idx',
    'cmo_snapshot_time_idx'
  )
ORDER BY idx_scan DESC;
-- After ~10 minutes of /arbitrage and /top-lines traffic, the
-- po_event_time_idx and cmo_event_time_idx rows should show
-- idx_scan in the 100s — that confirms the planner is picking them.

-- ── 4. EXPLAIN ANALYZE the hot Arb loader query ──────────────────
-- Mirrors lib/arbitrage/loaders.ts: pull current_market_odds for the
-- next 500 upcoming events within the last 15 min. Adjust the event
-- ids below by first running the inner SELECT to grab a real list.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, event_id, source_id, market_type, outcome, line_value,
       price_american, snapshot_time
FROM current_market_odds
WHERE event_id IN (
        SELECT id FROM events
        WHERE start_time > now()
        ORDER BY start_time ASC
        LIMIT 500
      )
  AND snapshot_time > now() - interval '15 minutes'
LIMIT 5000;
-- WANT: an "Index Scan using cmo_event_time_idx on current_market_odds"
-- (or BitmapIndexScan on cmo_event_time_idx). If you see a
-- "Seq Scan on current_market_odds" with a Filter, the index is NOT
-- being used — re-run ANALYZE current_market_odds and check stats.

-- ── 5. EXPLAIN ANALYZE the EV market_type variant ────────────────
-- Mirrors the moneyline pull pattern.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, event_id, source_id, market_type, outcome, line_value,
       price_american, snapshot_time
FROM current_market_odds
WHERE event_id IN (
        SELECT id FROM events
        WHERE start_time > now()
        ORDER BY start_time ASC
        LIMIT 500
      )
  AND market_type = 'moneyline'
  AND snapshot_time > now() - interval '15 minutes'
LIMIT 5000;
-- WANT: Index Scan using cmo_event_market_time_idx
-- (the 3-column composite is the best fit for this filter shape).

-- ── 6. EXPLAIN ANALYZE the prop_odds loader query ────────────────
-- Mirrors lib/ev/loaders.ts and lib/arbitrage/loaders.ts prop pulls.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, event_id, source_id, market_category, player_name,
       line_value, over_price, under_price, snapshot_time
FROM prop_odds
WHERE event_id IN (
        SELECT id FROM events
        WHERE start_time > now()
        ORDER BY start_time ASC
        LIMIT 500
      )
  AND snapshot_time > now() - interval '15 minutes'
  AND (over_price IS NOT NULL OR under_price IS NOT NULL)
LIMIT 5000;
-- WANT: Index Scan using po_event_time_idx on prop_odds.

-- ── 7. Optional: stale-index cleanup probe ───────────────────────
-- If you see indexes that have idx_scan = 0 after a few days of
-- traffic, they are unused and safe to DROP. Don't drop the
-- snapshot_time-only ones until you've confirmed nightly cleanup
-- jobs have run — they hit po_snapshot_time_idx / cmo_snapshot_time_idx.
