-- Expand the market_type enum + CHECK constraint to cover the alternate-period
-- and team-specific game-line markets that Novig (and other exchanges) ship
-- alongside the main moneyline/spread/total markets.
--
-- New values:
--   spread_h1   — first-half spread (basketball / football / hockey)
--   total_h1    — first-half total
--   total_i1    — first-inning total (baseball)
--   team_total  — team-specific total (over/under for one team's score)
--
-- `futures` already exists in the enum from 001_initial_schema but is not
-- allowed by current_market_odds' CHECK constraint today. Add it here so
-- Novig's CHAMPIONSHIP_WINNER and similar season-long markets can land.

BEGIN;

ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'moneyline_h1';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'spread_h1';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'total_h1';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'total_i1';
ALTER TYPE market_type ADD VALUE IF NOT EXISTS 'team_total';

COMMIT;

-- Postgres requires new enum values to be committed before they can be used
-- in expressions (like CHECK constraints), hence the separate transaction.

BEGIN;

ALTER TABLE current_market_odds
  DROP CONSTRAINT IF EXISTS current_market_odds_market_type_check;

ALTER TABLE current_market_odds
  ADD CONSTRAINT current_market_odds_market_type_check
  CHECK (market_type IN (
    'moneyline', 'spread', 'total',
    'moneyline_h1', 'spread_h1', 'total_h1', 'total_i1', 'team_total',
    'futures'
  ));

COMMIT;
