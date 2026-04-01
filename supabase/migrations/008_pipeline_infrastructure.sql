-- ── pipeline_runs ─────────────────────────────────────────────────────────────
-- One row per pipeline execution attempt.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_slug    TEXT NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','success','failed','skipped')),
  events_fetched   INT NOT NULL DEFAULT 0,
  markets_fetched  INT NOT NULL DEFAULT 0,
  error_count      INT NOT NULL DEFAULT 0,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pipeline_runs"
  ON pipeline_runs FOR ALL
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE INDEX IF NOT EXISTS pipeline_runs_slug_started
  ON pipeline_runs (pipeline_slug, started_at DESC);

-- ── pipeline_errors ───────────────────────────────────────────────────────────
-- Structured error log attached to a run or standalone.
CREATE TABLE IF NOT EXISTS pipeline_errors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_slug    TEXT NOT NULL,
  run_id           UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  error_type       TEXT NOT NULL DEFAULT 'unknown',   -- 'not_implemented', 'network', 'parse', 'auth', 'unknown'
  error_message    TEXT NOT NULL,
  error_stack      TEXT,
  context          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pipeline_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage pipeline_errors"
  ON pipeline_errors FOR ALL
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE INDEX IF NOT EXISTS pipeline_errors_slug_created
  ON pipeline_errors (pipeline_slug, created_at DESC);

-- ── raw_source_payloads ───────────────────────────────────────────────────────
-- Stores verbatim JSON responses from source adapters for debugging / replay.
CREATE TABLE IF NOT EXISTS raw_source_payloads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_slug    TEXT NOT NULL,
  run_id           UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  payload_type     TEXT NOT NULL DEFAULT 'events'
                     CHECK (payload_type IN ('events','markets','health','other')),
  payload          JSONB NOT NULL,
  byte_size        INT GENERATED ALWAYS AS (octet_length(payload::TEXT)) STORED,
  captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE raw_source_payloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage raw_source_payloads"
  ON raw_source_payloads FOR ALL
  USING  (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE));

CREATE INDEX IF NOT EXISTS raw_payloads_slug_captured
  ON raw_source_payloads (pipeline_slug, captured_at DESC);

-- Automatic 30-day retention: payloads older than 30 days are not needed for
-- replay debugging. Run this periodically or via a Supabase cron extension.
-- DELETE FROM raw_source_payloads WHERE captured_at < NOW() - INTERVAL '30 days';
