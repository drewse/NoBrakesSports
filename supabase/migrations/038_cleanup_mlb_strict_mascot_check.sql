-- ============================================================
-- Migration 038: Delete MLB events whose title doesn't contain
-- 2+ canonical MLB team mascots
-- ============================================================
--
-- Migration 037 caught KBO games + obvious malformed titles (no
-- "vs"), but production still showed three classes of leakage:
--
--   1. NCAA baseball — "Clemson Tigers vs Boston College Eagles".
--      Has "vs" so 037 doesn't catch it. "Tigers" matches MLB
--      Detroit Tigers but "Eagles" matches no MLB team. Should be
--      removed from the MLB tab.
--
--   2. Possibly more KBO/NPB/Mexican League games whose mascots
--      don't appear in the 037 explicit list.
--
--   3. Concatenated titles like "Boston Red Sox Houston Astros"
--      (variants). 037 only caught those WITHOUT " vs " — if the
--      malformed title happens to include "vs" elsewhere (e.g.
--      "vs." mid-string), it slipped through.
--
-- Stricter approach: every healthy MLB matchup contains at least
-- TWO distinct canonical mascots. If a row tagged league_slug='mlb'
-- has fewer than 2, it's not a real MLB game. Delete it.
--
-- Real Athletics vs Cleveland Guardians keeps both mascots ✓
-- Real Boston Red Sox vs Houston Astros keeps both mascots ✓
-- NCAA Clemson Tigers vs Boston College Eagles → only Tigers, dropped
-- KBO LG Twins vs NC Dinos                       → only Twins, dropped

BEGIN;

-- 30-team canonical MLB mascot set. Update if MLB renames a team
-- (the "Athletics" / "Guardians" rebranded entries are already here).
WITH mlb_mascots(mascot) AS (VALUES
  ('Diamondbacks'),
  ('Braves'),
  ('Orioles'),
  ('Red Sox'),
  ('Cubs'),
  ('White Sox'),
  ('Reds'),
  ('Guardians'),
  ('Rockies'),
  ('Tigers'),
  ('Astros'),
  ('Royals'),
  ('Angels'),
  ('Dodgers'),
  ('Marlins'),
  ('Brewers'),
  ('Twins'),
  ('Mets'),
  ('Yankees'),
  ('Athletics'),
  ('Phillies'),
  ('Pirates'),
  ('Padres'),
  ('Mariners'),
  ('Giants'),
  ('Cardinals'),
  ('Rays'),
  ('Rangers'),
  ('Blue Jays'),
  ('Nationals')
),
mlb_events_with_count AS (
  SELECT e.id,
    (SELECT COUNT(DISTINCT m.mascot)
     FROM mlb_mascots m
     WHERE e.title ILIKE '%' || m.mascot || '%') AS mascot_count
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'mlb'
)
DELETE FROM events
WHERE id IN (
  SELECT id FROM mlb_events_with_count WHERE mascot_count < 2
);

COMMIT;

-- Sanity check after running:
--   SELECT title FROM events e
--   JOIN leagues l ON l.id = e.league_id
--   WHERE l.slug = 'mlb'
--   ORDER BY e.start_time;
-- want: only "Home vs Away" titles where both halves are MLB teams.
