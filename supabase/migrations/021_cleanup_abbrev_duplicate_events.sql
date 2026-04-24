-- Remove duplicate events whose title uses the short "ABBR Nickname"
-- form ("HOU Rockets vs LA Lakers") when a full-name counterpart exists
-- for the same league on the same date ("Houston Rockets vs Los Angeles
-- Lakers"). These duplicates appeared because canonicalEventKey aliased
-- only a handful of city abbreviations — teams like HOU, PHI, POR, ORL,
-- PHX, DET fell through and hashed to a separate key, so adapters that
-- emit abbreviated names (Sportzino pre-hydration, Polymarket via loose
-- title matching) wrote to their own events instead of the canonical
-- ones.
--
-- TEAM_CITY_ALIASES has been expanded to cover every NBA/MLB/NHL/NFL
-- city abbreviation so future scrapes converge on the canonical event.
-- This migration cleans the historical duplicates.
--
-- Strategy: match events whose title has the "2-3 uppercase letters +
-- space + word" pattern on BOTH sides of "vs", and verify a non-abbrev
-- full-name event exists for the same league + date. Delete just the
-- abbreviated row — ON DELETE CASCADE on current_market_odds /
-- market_snapshots / prediction_market_snapshots / prop_odds clears the
-- associated market rows.
--
-- Safe to re-run: no-op on second execution if no abbreviated rows
-- remain matched to a canonical counterpart.

BEGIN;

WITH abbrev_events AS (
  SELECT e.id, e.title, e.league_id, e.start_time::date AS event_date
  FROM events e
  WHERE e.title ~ '^[A-Z]{2,4}\s+\S+.*\s+vs\s+[A-Z]{2,4}\s+\S+'
    AND e.start_time > NOW() - INTERVAL '7 days'
),
has_canonical AS (
  SELECT a.id
  FROM abbrev_events a
  WHERE EXISTS (
    SELECT 1 FROM events c
    WHERE c.id <> a.id
      AND c.league_id = a.league_id
      AND c.start_time::date = a.event_date
      -- Canonical counterpart: title does NOT match the abbreviation
      -- pattern on either side.
      AND c.title !~ '^[A-Z]{2,4}\s+\S+.*\s+vs\s+[A-Z]{2,4}\s+\S+'
  )
)
DELETE FROM events
WHERE id IN (SELECT id FROM has_canonical);

COMMIT;
