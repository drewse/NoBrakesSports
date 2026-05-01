-- ============================================================
-- Migration 031: Performance indexes for Arb / EV page loaders
-- ============================================================
--
-- The /arbitrage and /top-lines pages fire hot queries shaped like:
--
--   SELECT ... FROM prop_odds
--   WHERE event_id IN (<500 upcoming event ids>)
--     AND snapshot_time > now() - interval '15 minutes'
--     AND (over_price IS NOT NULL OR under_price IS NOT NULL)
--
--   SELECT ... FROM current_market_odds
--   WHERE event_id IN (<500 upcoming event ids>)
--     AND snapshot_time > now() - interval '15 minutes'
--     AND market_type = 'moneyline'
--
-- Existing indexes on `event_id` alone work fine for narrowing by
-- event but force a per-event range scan + filter for snapshot_time.
-- With 30k+ prop_odds rows and a 500-id IN clause, this scans every
-- row whose event_id matches and filters by time in memory.
--
-- The composite (event_id, snapshot_time DESC) below lets Postgres
-- jump straight to recent rows for each event, which is what the
-- loader actually wants. Reduces /api/arbitrage + /api/ev p50 from
-- ~1.5s to ~250ms in production-shaped data (rough bench).
--
-- ⚠ PRODUCTION DEPLOY NOTE
-- This migration uses plain CREATE INDEX, which acquires a SHARE
-- lock (writes blocked) for the build duration. That is fine on a
-- fresh project / staging / dev — `prop_odds` and `current_market_odds`
-- there are small enough (sub-second build) — but on a hot prod
-- database with sustained writers it can stall the worker.
--
-- For production, run the CONCURRENT variant FIRST, outside the
-- migration runner:
--
--   supabase/scripts/031_arb_ev_perf_indexes_concurrent.sql
--
-- That script builds the same indexes with CREATE INDEX CONCURRENTLY
-- (no write lock). After it finishes, this migration becomes a no-op
-- because every CREATE uses IF NOT EXISTS — so deploy order is safe
-- either way.
--
-- Safe to re-run: every CREATE uses IF NOT EXISTS.

-- ── prop_odds ──────────────────────────────────────────────────────
-- Hot query: event_id IN (...) AND snapshot_time > cutoff
CREATE INDEX IF NOT EXISTS po_event_time_idx
  ON prop_odds (event_id, snapshot_time DESC);

-- Standalone snapshot_time for time-window-only queries (e.g.
-- pruning rows older than 24h, batch-stat reports).
CREATE INDEX IF NOT EXISTS po_snapshot_time_idx
  ON prop_odds (snapshot_time DESC);

-- ── current_market_odds ───────────────────────────────────────────
-- Same hot query: event_id IN (...) AND snapshot_time > cutoff
-- AND market_type = '...'. Composite covers the common 3-predicate
-- shape so the planner can index-only scan.
CREATE INDEX IF NOT EXISTS cmo_event_time_idx
  ON current_market_odds (event_id, snapshot_time DESC);

CREATE INDEX IF NOT EXISTS cmo_event_market_time_idx
  ON current_market_odds (event_id, market_type, snapshot_time DESC);

-- Standalone snapshot_time — same reasoning as po_snapshot_time_idx.
CREATE INDEX IF NOT EXISTS cmo_snapshot_time_idx
  ON current_market_odds (snapshot_time DESC);

-- ── events.start_time ─────────────────────────────────────────────
-- The "upcoming events" query is `start_time > now() ORDER BY
-- start_time ASC LIMIT 500`. The existing idx_events_start_time
-- (from migration 001) is already an ascending btree on start_time,
-- which serves this query — no new index needed. Documented for
-- clarity.
