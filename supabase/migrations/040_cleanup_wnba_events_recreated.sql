-- ============================================================
-- Migration 040: Re-clean WNBA events that Pinnacle re-created
-- ============================================================
--
-- Migration 036 deleted WNBA events tagged as NBA, but Pinnacle's
-- Vercel-side adapter (lib/pipelines/adapters/pinnacle.ts) was
-- silently re-creating them. Root cause was in toLeagueSlug():
--
--   for (const [key, slug] of Object.entries(LEAGUE_SLUG_MAP)) {
--     if (n.includes(key) || n.endsWith('. ' + key)) return slug
--   }
--
-- "WNBA".includes("NBA") returns true, so Pinnacle's WNBA league name
-- got mapped to slug='nba' on every cron tick. Adapter has been
-- patched to use word-boundary regex + explicit WNBA blocklist.
-- This migration clears the rows that landed in the meantime.
--
-- Same WNBA mascot list as 036 (current 12 + 2 announced expansions).

BEGIN;

DELETE FROM events
WHERE id IN (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'nba'
    AND (
      e.title ILIKE '%lynx%'
      OR e.title ILIKE '%aces%'
      OR e.title ILIKE '%liberty%'
      OR e.title ILIKE '%fever%'
      OR e.title ILIKE '%dream%'
      OR e.title ILIKE '%mystics%'
      OR e.title ILIKE '%storm%'
      OR e.title ILIKE '%mercury%'
      OR e.title ILIKE '%sparks%'
      OR e.title ILIKE '%wings%'
      OR e.title ILIKE '%sky%'
      OR e.title ILIKE '%valkyries%'
      OR e.title ILIKE '%tempo%'
    )
);

COMMIT;

-- After Vercel redeploys with the patched toLeagueSlug, Pinnacle
-- stops creating these events. Re-run this DELETE if a new WNBA
-- mascot appears (e.g. Toronto Tempo 2026 expansion already in list,
-- but watch for further team additions).
