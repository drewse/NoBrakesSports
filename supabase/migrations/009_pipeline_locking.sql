-- ── 009_pipeline_locking.sql ──────────────────────────────────────────────────
-- Adds safety fields for lock/heartbeat tracking to prevent runaway pipeline
-- executions from hammering Supabase CPU.
--
-- Root cause of the Apr-2026 CPU spike: no lock mechanism meant multiple
-- concurrent ingestPipeline() calls could fire simultaneously (double-click,
-- cron + manual overlap), and no timeout meant a stuck adapter held DB
-- connections open indefinitely.
--
-- These columns give us:
--   is_running      — atomic lock flag (set before fetch, cleared in finally)
--   locked_at       — timestamp of lock acquisition (for stale-lock detection)
--   last_heartbeat_at — updated every ~30s by long-running adapters
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add locking columns to data_pipelines ──────────────────────────────────
ALTER TABLE data_pipelines
  ADD COLUMN IF NOT EXISTS is_running         BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at  TIMESTAMPTZ;

-- Fast lookup for stale-lock cleanup query
CREATE INDEX IF NOT EXISTS data_pipelines_is_running_idx
  ON data_pipelines (is_running)
  WHERE is_running = TRUE;

-- ── 2. Extend pipeline_runs with ingestion counts + trigger info ───────────────
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS snapshots_inserted  INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trigger_source      TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'cron', 'api')),
  ADD COLUMN IF NOT EXISTS timed_out           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS error_messages      TEXT[];  -- array of error strings

-- ── 3. Safety: clear any is_running flags left over from crashed functions ─────
-- Run this once immediately after applying the migration to reset any stuck state.
UPDATE data_pipelines
  SET is_running = FALSE, locked_at = NULL
  WHERE is_running = TRUE;
