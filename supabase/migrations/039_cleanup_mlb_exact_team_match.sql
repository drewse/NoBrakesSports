-- ============================================================
-- Migration 039: Delete MLB events whose split-title halves
--                aren't exact canonical MLB team names
-- ============================================================
--
-- Migration 038 used a substring-mascot count: any MLB-tagged event
-- whose title contained ≥2 distinct mascots was kept. Production
-- showed three failure modes for that approach:
--
--   1. NPB ("Hanshin Tigers vs Yomiuri Giants") — both "Tigers"
--      and "Giants" are MLB mascots, so substring check passes,
--      but neither half is a real MLB team name.
--
--   2. NCAA ("Louisville Cardinals vs Clemson Tigers", "Memphis
--      Tigers vs East Carolina Pirates") — Cardinals / Tigers /
--      Pirates all share mascots with MLB. Same false-positive.
--
--   3. Malformed concat-with-mid-vs ("Los Angeles vs Angels New
--      York Mets", "San Francisco vs Giants Miami Marlins") —
--      these have " vs " between a city and its OWN mascot, then
--      the second team's full name concatenated. Both fragments
--      contain MLB mascots so 038's check passed, but the halves
--      are nonsense ("Los Angeles" alone, "Angels New York Mets").
--
-- Stricter approach: require each half of split-on-vs to EXACTLY
-- match one of the 30 canonical MLB team names (lowercased). The
-- "Athletics" club currently uses three forms in the DB (no city,
-- "Oakland Athletics", "Sacramento Athletics" depending on era);
-- all three are accepted. "St Louis" / "St. Louis" period variant
-- accepted too.
--
-- Real games keep both halves matching exactly; everything else
-- gets dropped. CASCADE on the events FK clears related snapshots.

BEGIN;

WITH valid_team_names(name) AS (VALUES
  ('arizona diamondbacks'),
  ('atlanta braves'),
  ('baltimore orioles'),
  ('boston red sox'),
  ('chicago cubs'),
  ('chicago white sox'),
  ('cincinnati reds'),
  ('cleveland guardians'),
  ('colorado rockies'),
  ('detroit tigers'),
  ('houston astros'),
  ('kansas city royals'),
  ('los angeles angels'),
  ('los angeles dodgers'),
  ('miami marlins'),
  ('milwaukee brewers'),
  ('minnesota twins'),
  ('new york mets'),
  ('new york yankees'),
  ('athletics'),               -- generic used by some adapters
  ('oakland athletics'),       -- legacy
  ('sacramento athletics'),    -- temporary 2025-26 home
  ('las vegas athletics'),     -- future once stadium opens
  ('philadelphia phillies'),
  ('pittsburgh pirates'),
  ('san diego padres'),
  ('san francisco giants'),
  ('seattle mariners'),
  ('st. louis cardinals'),
  ('st louis cardinals'),
  ('tampa bay rays'),
  ('texas rangers'),
  ('toronto blue jays'),
  ('washington nationals')
)
DELETE FROM events
WHERE id IN (
  SELECT e.id FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'mlb'
    AND NOT (
      LOWER(TRIM(SPLIT_PART(e.title, ' vs ', 1))) IN (SELECT name FROM valid_team_names)
      AND LOWER(TRIM(SPLIT_PART(e.title, ' vs ', 2))) IN (SELECT name FROM valid_team_names)
    )
);

COMMIT;

-- Sanity check after running:
--   SELECT title FROM events e
--   JOIN leagues l ON l.id = e.league_id
--   WHERE l.slug = 'mlb'
--   ORDER BY e.title;
-- want: every row is "<canonical team> vs <canonical team>".
