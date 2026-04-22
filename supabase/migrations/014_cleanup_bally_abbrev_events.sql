-- One-shot cleanup: delete events Bally Bet created using abbreviated team
-- names (lang=en_US) before the adapter was switched to lang=en_CA.
--
-- Pattern: abbreviated titles start with a 2-4 letter all-caps code followed
-- by a space and a word, e.g. "DET Pistons vs ORL Magic", "OKC Thunder vs
-- PHO Suns". The canonical full-name events ("Detroit Pistons vs Orlando
-- Magic") already exist with their own market_snapshots from 14+ sources;
-- these Bally orphans are standalone duplicates.
--
-- Strategy:
--   1. Identify events whose title matches the abbreviation pattern AND
--      whose ONLY market_snapshots are from the Bally source.
--   2. Delete those events. ON DELETE CASCADE on market_snapshots /
--      game_market_snapshots / etc. will remove the child rows.
--
-- Bally's next cycle (~3 min after fc7f29c deploy) will re-upsert the same
-- games against the canonical events using full names.
--
-- Safe to re-run: if no rows match, it's a no-op.

BEGIN;

WITH bally AS (
  SELECT id FROM market_sources WHERE slug = 'ballybet' LIMIT 1
),
abbrev_events AS (
  SELECT e.id, e.title
  FROM events e
  -- Title like "XXX Word vs XXX Word" — 2-4 uppercase letters,
  -- space, word, " vs ", 2-4 uppercase letters, space, word.
  WHERE e.title ~ '^[A-Z]{2,4} [A-Za-z]+ vs [A-Z]{2,4} [A-Za-z]+'
),
events_only_on_bally AS (
  SELECT ae.id
  FROM abbrev_events ae
  WHERE NOT EXISTS (
    SELECT 1
    FROM market_snapshots ms
    WHERE ms.event_id = ae.id
      AND ms.source_id <> (SELECT id FROM bally)
  )
)
DELETE FROM events
WHERE id IN (SELECT id FROM events_only_on_bally);

COMMIT;
