-- ============================================================
-- Migration 037: Remove KBO games + malformed titles from MLB
-- ============================================================
--
-- /odds NBA tab earlier had WNBA games leaking through (fixed in
-- migration 036). The MLB tab has the same class of bug:
--
--   1. KBO (Korean Baseball Organization) games tagged as MLB.
--      Examples seen on production: "LG Twins vs NC Dinos",
--      "SSG Landers vs Lotte Giants", "KIA Tigers vs KT Wiz".
--      Polymarket has these tagged as `baseball` and our adapter's
--      POLY_TAG_TO_LEAGUES maps `baseball: ['mlb']` — when the DB
--      already has these events under league_slug='mlb' (from a
--      pre-patch Sportzino write or another adapter), Polymarket
--      matches them by title and writes more snapshots.
--
--   2. Malformed titles where two MLB team names got concatenated
--      without a "vs" separator. Examples on production:
--        "San Diego Padres Chicago White Sox" — parsed as home=
--        "San Diego" and away="Padres Chicago White Sox"
--        "Boston Red Sox Houston Astros" — same shape
--      These create duplicate events: a real proper-format row
--      AND a malformed row, both showing on /odds.
--
-- Both cleanups CASCADE through the events FK to delete related
-- market_snapshots / current_market_odds / prop_odds rows.

BEGIN;

-- ── 1. KBO games misclassified as MLB ──────────────────────────────
-- KBO teams are well-known + relatively unique (LG / NC / SSG / KT /
-- Hanwha / Doosan / Kiwoom / Samsung Lions / Lotte Giants / KIA Tigers).
-- Some shorter mascots ("Twins", "Tigers", "Lions", "Giants") collide
-- with MLB / college teams, so we anchor the deletion on the
-- DISTINCTLY-KBO city-prefix or two-word combo.
WITH kbo_event_ids AS (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'mlb'
    AND (
      e.title ILIKE '%lg twins%'
      OR e.title ILIKE '%nc dinos%'
      OR e.title ILIKE '%kt wiz%'
      OR e.title ILIKE '%kia tigers%'        -- KIA, not Kansas City
      OR e.title ILIKE '%lotte giants%'      -- Lotte, not San Francisco
      OR e.title ILIKE '%samsung lions%'
      OR e.title ILIKE '%ssg landers%'
      OR e.title ILIKE '%doosan bears%'
      OR e.title ILIKE '%hanwha eagles%'
      OR e.title ILIKE '%kiwoom heroes%'
    )
)
DELETE FROM events
WHERE id IN (SELECT id FROM kbo_event_ids);

-- ── 2. Malformed MLB events lacking the "vs" separator ────────────
-- Every healthy MLB event title in the codebase is "Home vs Away".
-- Any MLB-tagged event without " vs " (case-insensitive) is the
-- result of bad title parsing somewhere upstream — drop it. The
-- proper-format duplicate stays.
DELETE FROM events
WHERE id IN (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'mlb'
    AND e.title NOT ILIKE '% vs %'
);

COMMIT;

-- Sanity check after running:
--
--   SELECT COUNT(*) FROM events e
--   JOIN leagues l ON l.id = e.league_id
--   WHERE l.slug = 'mlb'
--     AND (e.title ILIKE '%lg twins%' OR e.title ILIKE '%kia tigers%'
--          OR e.title NOT ILIKE '% vs %');
-- want: 0
