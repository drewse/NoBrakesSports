-- ============================================================
-- Migration 036: Remove WNBA games misclassified as NBA
-- ============================================================
--
-- The /odds page (NBA tab) was showing "Minnesota Lynx vs Toronto
-- Tempo Women" — a WNBA matchup with prices from Polymarket and
-- Sportzino. The Sportzino adapter was already patched to filter
-- non-canonical-NBA teams (commit e7c8487), but the underlying
-- events row had been created BEFORE that fix landed and persists
-- under league_slug='nba'. Polymarket then matched poly events to
-- this WNBA row by title and kept writing snapshots into it.
--
-- This migration deletes any events tied to the NBA league whose
-- title contains a WNBA team name. CASCADE on the events FK
-- removes the related market_snapshots / current_market_odds /
-- prop_odds rows automatically.
--
-- WNBA team list (current 12 + 2 announced expansions: Valkyries,
-- Tempo). If WNBA expansion adds more teams later, append here.
-- Matching is case-insensitive on a substring of the event title —
-- a Mercury/Aces matchup whose title is "Phoenix Mercury vs Las
-- Vegas Aces" will hit BOTH name patterns; the OR collapse handles it.

BEGIN;

WITH wnba_event_ids AS (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'nba'
    AND (
      e.title ILIKE '%lynx%'           -- Minnesota Lynx
      OR e.title ILIKE '%aces%'         -- Las Vegas Aces (NBA has no Aces)
      OR e.title ILIKE '%liberty%'      -- New York Liberty
      OR e.title ILIKE '%fever%'        -- Indiana Fever
      OR e.title ILIKE '%dream%'        -- Atlanta Dream
      OR e.title ILIKE '%mystics%'      -- Washington Mystics
      OR e.title ILIKE '%storm%'        -- Seattle Storm
      OR e.title ILIKE '%mercury%'      -- Phoenix Mercury (NBA has no Mercury)
      OR e.title ILIKE '%sparks%'       -- Los Angeles Sparks
      OR e.title ILIKE '%wings%'        -- Dallas Wings
      OR e.title ILIKE '%sky%'          -- Chicago Sky
      OR e.title ILIKE '%sun%'          -- Connecticut Sun
      OR e.title ILIKE '%valkyries%'    -- Golden State Valkyries (2025 expansion)
      OR e.title ILIKE '%tempo%'        -- Toronto Tempo (2026 expansion)
      OR e.title ILIKE '%tempo women%'
    )
)
DELETE FROM events
WHERE id IN (SELECT id FROM wnba_event_ids);

COMMIT;

-- Sanity check after running:
--   SELECT COUNT(*) FROM events e
--   JOIN leagues l ON l.id = e.league_id
--   WHERE l.slug = 'nba'
--     AND (e.title ILIKE '%lynx%' OR e.title ILIKE '%tempo%' OR
--          e.title ILIKE '%aces%' OR e.title ILIKE '%liberty%');
-- want: 0
