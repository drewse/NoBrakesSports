-- Cleanup of wrong game-market odds that were written before three
-- adapter fixes landed:
--
--   1. proline / ballybet (Kambi white-labels) were grabbing the first
--      Over/Under or Handicap offer returned by the API — Kambi returns
--      the main line plus a dozen alts per event, so we often stored an
--      alt's price (e.g. Over 225.5 @ +235) as if it were the main.
--      Fixed by filtering for `main: true` on the offer.
--
--   2. fanatics_markets' REST endpoint returns `probability: 0.5` for
--      every contract on events that haven't started trading yet. Our
--      converter turned that into +100 American, which surfaced every
--      non-trading event as a massive fake +EV opportunity.
--      Fixed by treating p === 0.5 as a "not-trading" sentinel.
--
-- The code fixes stop new bad rows from being written, but the existing
-- rows persist because current_market_odds is upserted on
-- (event_id, source_id, market_type, line_value) — the fixed scrape
-- writes a NEW row at the correct line_value, leaving the old alt-line
-- row orphaned. Delete them here so the +EV page clears immediately;
-- the next scheduled scrape repopulates with correct data within
-- minutes.
--
-- Scope: only game-market rows (moneyline/spread/total) for the three
-- affected sources. Props are untouched (separate table).
-- Safe to re-run — no-op on second execution if nothing matches.

BEGIN;

DELETE FROM current_market_odds
WHERE source_id IN (
        SELECT id FROM market_sources
        WHERE slug IN ('proline', 'ballybet', 'fanatics_markets')
      )
  AND market_type IN ('moneyline', 'spread', 'total');

COMMIT;
