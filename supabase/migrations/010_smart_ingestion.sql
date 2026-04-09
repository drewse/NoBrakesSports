-- ── 010_smart_ingestion.sql ────────────────────────────────────────────────────
--
-- Root cause of Apr-2026 CPU spike:
--   Every pipeline run inserted ALL market snapshots regardless of whether
--   odds changed. With Pinnacle at 50 events × 3 markets = 150 inserts/run,
--   and multiple cron runs per hour, the market_snapshots table became a
--   hot append-only log driving constant write pressure.  The arbitrage and
--   markets pages then had to scan 2,000+ rows per query to find the latest
--   price per (event, source, market_type) combo — a O(n) scan on a
--   ever-growing table.
--
-- This migration introduces:
--
--   1. current_market_odds — ONE row per (event, source, market_type).
--      Updated on every run; market_snapshots only gets a new row when
--      odds actually changed.  Arbitrage/markets queries hit this tiny
--      table (<1k rows) instead of scanning millions of snapshots.
--
--   2. odds_hash column on market_snapshots — fingerprint for the price
--      state.  Enables fast equality check without re-reading all columns.
--
--   3. Circuit breaker columns on data_pipelines — consecutive_failures,
--      circuit_open_at.  Prevents a broken adapter from hammering Supabase
--      in a tight cron loop.
--
--   4. payload_hash on raw_source_payloads + last_payload_hash on
--      data_pipelines — deduplicates raw payload storage so we don't
--      insert multi-MB JSONB blobs on every run when data is stable.
--
--   5. no-op tracking on pipeline_runs — snapshots_changed,
--      snapshots_skipped, is_no_op — so the dashboard can show whether
--      a run did useful work or just burned CPU confirming nothing changed.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. current_market_odds ────────────────────────────────────────────────────
-- Canonical current-state table: ONE row per (event, source, market_type).
-- Hot-path for arbitrage + markets pages — always small, always indexed.
-- market_snapshots is now a history/audit log; this is the live view.

CREATE TABLE IF NOT EXISTS current_market_odds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES market_sources(id) ON DELETE CASCADE,
  market_type       TEXT NOT NULL CHECK (market_type IN ('moneyline','spread','total')),

  -- Change fingerprint: pipe-delimited price fields.  Same hash → no write to
  -- market_snapshots.  Different hash → update here AND append to market_snapshots.
  odds_hash         TEXT NOT NULL,

  -- Price columns mirror market_snapshots exactly so pages can join either table.
  home_price        INT,
  away_price        INT,
  draw_price        INT,
  spread_value      NUMERIC(10,3),
  total_value       NUMERIC(10,3),
  over_price        INT,
  under_price       INT,
  home_implied_prob NUMERIC(6,4),
  away_implied_prob NUMERIC(6,4),
  movement_direction TEXT NOT NULL DEFAULT 'flat',

  -- Timestamp semantics:
  --   snapshot_time  = last time we fetched this (even if unchanged)
  --   changed_at     = last time odds actually moved
  snapshot_time     TIMESTAMPTZ NOT NULL,
  changed_at        TIMESTAMPTZ NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (event_id, source_id, market_type)
);

ALTER TABLE current_market_odds ENABLE ROW LEVEL SECURITY;

-- Same tier gate as market_snapshots: free users see recent, pro see all.
CREATE POLICY "Free users can view current odds"
  ON current_market_odds FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND snapshot_time > NOW() - INTERVAL '24 hours'
  );

CREATE POLICY "Pro users can view all current odds"
  ON current_market_odds FOR SELECT
  USING (is_pro_user());

CREATE POLICY "Admins manage current_market_odds"
  ON current_market_odds FOR ALL
  USING (is_admin());

-- Indexes for the two main query patterns:
--   arbitrage: WHERE market_type = 'moneyline'
--   markets:   WHERE event_id = ANY(ids)
CREATE INDEX IF NOT EXISTS cmo_market_type_idx   ON current_market_odds (market_type);
CREATE INDEX IF NOT EXISTS cmo_event_id_idx      ON current_market_odds (event_id);
CREATE INDEX IF NOT EXISTS cmo_source_id_idx     ON current_market_odds (source_id);
-- Composite for efficient per-event-source upsert conflict lookup
CREATE INDEX IF NOT EXISTS cmo_event_source_idx  ON current_market_odds (event_id, source_id);

-- ── 2. odds_hash on market_snapshots ─────────────────────────────────────────
-- Stores the change fingerprint alongside each historical row so we can
-- quickly answer "did this run actually move the line?" in telemetry.
ALTER TABLE market_snapshots
  ADD COLUMN IF NOT EXISTS odds_hash TEXT;

-- Composite index for efficient history queries ordered by time.
-- Replaces the previous pattern of scanning by snapshot_time alone.
CREATE INDEX IF NOT EXISTS ms_event_source_type_time_idx
  ON market_snapshots (event_id, source_id, market_type, snapshot_time DESC);

-- ── 3. Circuit breaker + payload hash on data_pipelines ───────────────────────
ALTER TABLE data_pipelines
  ADD COLUMN IF NOT EXISTS consecutive_failures  INT         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS circuit_open_at       TIMESTAMPTZ,          -- set when circuit trips
  ADD COLUMN IF NOT EXISTS last_payload_hash     TEXT;                 -- for raw payload dedup

-- ── 4. payload_hash on raw_source_payloads ────────────────────────────────────
-- Lets us skip storing an identical payload blob we already have.
ALTER TABLE raw_source_payloads
  ADD COLUMN IF NOT EXISTS payload_hash TEXT;

CREATE INDEX IF NOT EXISTS rsp_slug_hash_idx
  ON raw_source_payloads (pipeline_slug, payload_hash)
  WHERE payload_hash IS NOT NULL;

-- ── 5. No-op tracking on pipeline_runs ───────────────────────────────────────
-- snapshots_changed: how many market rows actually had a different hash
-- snapshots_skipped: how many were identical (no-op, not written to history)
-- is_no_op:          true when zero snapshots changed (entire run was wasted)
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS snapshots_changed  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS snapshots_skipped  INT     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_no_op           BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 6. raw_source_payloads: soft 7-day retention cleanup ─────────────────────
-- After migration, stale payload blobs older than 7 days provide little value.
-- Run manually or via pg_cron; safe to re-run.
-- DELETE FROM raw_source_payloads WHERE captured_at < NOW() - INTERVAL '7 days';
