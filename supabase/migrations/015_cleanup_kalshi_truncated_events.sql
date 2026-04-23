-- One-shot cleanup: remove events auto-created by sync-kalshi with
-- Kalshi's single-letter team disambiguators in the title ("Los Angeles L"
-- for Lakers, "New York M" for Mets, "Chicago WS" for White Sox, etc.)
-- before the adapter learned to map those to canonical full names.
--
-- Safe to run: the sync-kalshi cron (next fire) will recreate each game
-- under the correct canonical title now that CITY_MAPS handles the
-- single-letter variants. ON DELETE CASCADE on market_snapshots /
-- current_market_odds removes their Kalshi rows too.

BEGIN;

DELETE FROM events
WHERE source_metadata->>'created_by' = 'sync-kalshi'
  AND (
    title ~ '\y[A-Z][a-z]+ [A-Z]\y'  -- "Los Angeles L", "New York M", etc.
    OR title ~ '\y(L|C|D|A|K|M|R|Y|WS) vs '
    OR title ~ ' vs [A-Za-z ]+ (L|C|D|A|K|M|R|Y|WS)$'
  );

COMMIT;
