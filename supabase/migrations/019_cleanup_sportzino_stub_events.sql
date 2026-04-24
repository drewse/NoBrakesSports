-- Cleanup: delete stub events Sportzino created with half-abbreviated
-- titles ("NY Yankees vs BOS Red Sox", "ATL Hawks vs NYK Knicks" etc.)
-- before hydrateTeamName() landed in the adapter (commit d430024).
--
-- Strategy: match titles where both halves still start with a 2-4 letter
-- uppercase abbreviation AND the only source is Sportzino. The adapter
-- now writes canonical "Boston Red Sox vs New York Yankees" form so
-- any such stub is pre-fix data.
--
-- Safe to re-run: no-op if no rows match.

BEGIN;

WITH sportzino AS (
  SELECT id FROM market_sources WHERE slug = 'sportzino' LIMIT 1
),
stubs AS (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug IN ('nba','mlb','nhl','nfl')
    AND e.title ~ '^[A-Z]{2,4}\s+\w+.*\s+vs\s+[A-Z]{2,4}\s+\w+'
    AND e.start_time > NOW() - INTERVAL '2 days'
    AND EXISTS (
      SELECT 1 FROM current_market_odds cmo
      WHERE cmo.event_id = e.id
        AND cmo.source_id = (SELECT id FROM sportzino)
    )
    AND NOT EXISTS (
      SELECT 1 FROM current_market_odds cmo
      WHERE cmo.event_id = e.id
        AND cmo.source_id <> (SELECT id FROM sportzino)
    )
)
DELETE FROM events WHERE id IN (SELECT id FROM stubs);

COMMIT;
