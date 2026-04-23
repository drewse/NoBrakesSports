-- One-shot cleanup: delete event rows Novig created with abbreviated-only
-- team titles ("ATL vs NYK") that duplicate the canonical full-name rows
-- ("Atlanta Hawks vs New York Knicks") every other book matches against.
--
-- Root cause: Novig's GraphQL sometimes returns only `symbol` for a
-- team (no long_name), and the adapter previously fell through to the
-- symbol as the event's teamName. The writer couldn't match by title or
-- sorted-team-pair, so it auto-created a new row. The adapter is now
-- fixed (symbol→full-name hydration via per-league maps), so post-deploy
-- these stubs will stop being written. This migration removes the ones
-- already there.
--
-- Strategy: identify events whose title matches "XXX vs YYY" (2-4 upper
-- case letters each side) AND whose only market source is Novig. Delete
-- them. ON DELETE CASCADE on market_snapshots / current_market_odds / etc.
-- removes the child rows.
--
-- Safe to re-run: if no rows match, it's a no-op.

BEGIN;

WITH novig AS (
  SELECT id FROM market_sources WHERE slug = 'novig' LIMIT 1
),
novig_only_stubs AS (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug IN ('nba','mlb','nhl','nfl')
    AND e.title ~ '^[A-Z]{2,4}\s+vs\s+[A-Z]{2,4}$'
    AND e.start_time > NOW() - INTERVAL '2 days'
    AND EXISTS (
      SELECT 1 FROM current_market_odds cmo
      WHERE cmo.event_id = e.id
        AND cmo.source_id = (SELECT id FROM novig)
    )
    AND NOT EXISTS (
      SELECT 1 FROM current_market_odds cmo
      WHERE cmo.event_id = e.id
        AND cmo.source_id <> (SELECT id FROM novig)
    )
)
DELETE FROM events WHERE id IN (SELECT id FROM novig_only_stubs);

COMMIT;
