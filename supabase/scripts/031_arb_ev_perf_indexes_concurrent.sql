-- ============================================================
-- PRODUCTION-SAFE variant of migrations/031_arb_ev_perf_indexes.sql
-- ============================================================
--
-- Purpose
--   Creates the same composite indexes as migration 031, but using
--   CREATE INDEX CONCURRENTLY so writers on `prop_odds` and
--   `current_market_odds` are NOT blocked while the index builds.
--
-- Why a separate script
--   Supabase's migration runner wraps each .sql file in a single
--   transaction. CREATE INDEX CONCURRENTLY cannot run inside a
--   transaction (Postgres rejects it). Therefore migration 031 uses
--   plain CREATE INDEX, which is fine for fresh / dev installs but
--   takes an ACCESS EXCLUSIVE-style SHARE lock on a hot prod table
--   for the duration of the build (writes blocked).
--
-- When to use which
--   * Fresh project / staging / local dev .................. run migration 031 normally
--   * Production with hot writers + sizeable tables ........ run THIS script BEFORE migration 031,
--                                                            then migration 031 becomes a no-op
--                                                            (every CREATE uses IF NOT EXISTS).
--
-- How to run in production
--   Connect with psql (NOT through the migration runner) and run:
--
--     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/scripts/031_arb_ev_perf_indexes_concurrent.sql
--
--   Or paste the statements one-at-a-time in the Supabase SQL editor
--   with "Run as a single transaction" UNCHECKED.
--
-- Lock behavior
--   CONCURRENTLY takes only a SHARE UPDATE EXCLUSIVE lock — readers
--   AND writers can proceed. The trade-off is two table scans and
--   ~2-3x build time vs the locking variant. On 30k–500k row tables
--   this completes in seconds; on multi-million-row tables expect
--   30s–several minutes.
--
-- Failure behavior
--   If a CONCURRENT build fails (duplicate, kill, deadlock retry),
--   Postgres leaves an INVALID index entry. The block at the bottom
--   of this script (`DROP INDEX IF EXISTS ... <invalid>`) is
--   commented; check `pg_stat_user_indexes` first, then drop only
--   what is invalid.

-- ── prop_odds ──────────────────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS po_event_time_idx
  ON prop_odds (event_id, snapshot_time DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS po_snapshot_time_idx
  ON prop_odds (snapshot_time DESC);

-- ── current_market_odds ───────────────────────────────────────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS cmo_event_time_idx
  ON current_market_odds (event_id, snapshot_time DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS cmo_event_market_time_idx
  ON current_market_odds (event_id, market_type, snapshot_time DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS cmo_snapshot_time_idx
  ON current_market_odds (snapshot_time DESC);

-- ── ANALYZE so the planner picks them up immediately ──────────────
-- Cheap, no lock. Skip if you've just run a maintenance VACUUM ANALYZE.
ANALYZE prop_odds;
ANALYZE current_market_odds;

-- ── Cleanup of failed builds (optional, run only if needed) ───────
-- Run the verification script first (see verify_arb_ev_indexes.sql)
-- to confirm `indisvalid = true` for each index. If any is FALSE,
-- drop and re-create:
--
--   DROP INDEX CONCURRENTLY IF EXISTS po_event_time_idx;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS po_event_time_idx
--     ON prop_odds (event_id, snapshot_time DESC);
