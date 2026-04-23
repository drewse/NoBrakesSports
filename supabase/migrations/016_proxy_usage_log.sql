-- Per-scrape bandwidth log for Railway worker adapters that route through a
-- residential / mobile proxy. One row per scrape × proxy-gated context.
-- Client-side measurement (sum of response.body() sizes), so it misses
-- TLS/handshake overhead — typically ~5% under the proxy provider's meter.

BEGIN;

CREATE TABLE IF NOT EXISTS proxy_usage_log (
  id          bigserial PRIMARY KEY,
  adapter_slug text NOT NULL,
  proxy_tier   text NOT NULL,    -- 'mobile' | 'us-mobile' | 'residential' | 'us-residential'
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  scrape_ms    integer,          -- elapsed wall time for the scrape
  ts           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS proxy_usage_log_ts_idx
  ON proxy_usage_log (ts DESC);

CREATE INDEX IF NOT EXISTS proxy_usage_log_adapter_ts_idx
  ON proxy_usage_log (adapter_slug, ts DESC);

CREATE INDEX IF NOT EXISTS proxy_usage_log_tier_ts_idx
  ON proxy_usage_log (proxy_tier, ts DESC);

COMMIT;
