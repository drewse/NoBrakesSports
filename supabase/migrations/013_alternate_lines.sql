-- ── 013_alternate_lines.sql ───────────────────────────────────────────────────
--
-- Support alternate spread and total lines in current_market_odds.
--
-- Previously: UNIQUE(event_id, source_id, market_type) — one spread per book.
-- Now: UNIQUE(event_id, source_id, market_type, line_value) — multiple lines per book.
--
-- The line_value column stores the spread or total value (e.g., -6.5 or 243.5).
-- For moneyline rows, line_value is NULL (no line).
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Add line_value column to differentiate alternate lines
ALTER TABLE current_market_odds
  ADD COLUMN IF NOT EXISTS line_value NUMERIC(10,3);

-- Drop old unique constraint and create new one including line_value
-- The old constraint is the unnamed one from CREATE TABLE ... UNIQUE(event_id, source_id, market_type)
ALTER TABLE current_market_odds
  DROP CONSTRAINT IF EXISTS current_market_odds_event_id_source_id_market_type_key;

-- New constraint: allows multiple lines per (event, source, market_type)
-- COALESCE ensures NULL line_value (moneyline) still has a unique entry
ALTER TABLE current_market_odds
  ADD CONSTRAINT cmo_event_source_type_line_key
  UNIQUE (event_id, source_id, market_type, line_value);

-- Update existing composite index for upsert conflict resolution
DROP INDEX IF EXISTS cmo_event_source_idx;
CREATE INDEX IF NOT EXISTS cmo_event_source_type_line_idx
  ON current_market_odds (event_id, source_id, market_type, line_value);
