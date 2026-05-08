-- ============================================================
-- Migration 041: Block WNBA team names in the NBA league at the
--                DB layer with a trigger
-- ============================================================
--
-- Migrations 036 and 040 cleaned WNBA events out of the NBA league,
-- but they keep coming back. Multiple adapters can re-create them
-- (Polymarket matched stale rows, Pinnacle had a partial-match bug
-- in toLeagueSlug, possibly others we haven't audited). Patching
-- each adapter is whack-a-mole; what we need is a single guard at
-- the only place that ALWAYS runs: the DB itself.
--
-- This migration:
--   1. Re-deletes any existing WNBA-as-NBA events (now also
--      including Connecticut Sun which 036/040 missed).
--   2. Installs a BEFORE INSERT OR UPDATE trigger on events that
--      raises an exception if an adapter tries to write a row
--      tagged league_slug='nba' whose title contains any WNBA
--      mascot. The exception fails the upstream INSERT loudly so
--      the adapter logs the error rather than silently leaking.
--   3. Uses word-boundary regex (`\b`) so MLB "Phoenix Suns" /
--      NBA "Phoenix Suns" don't trip the trigger ('sun' won't
--      match inside "Suns"). 'Storm' / 'Mercury' / 'Sky' have no
--      NBA team conflicts.

BEGIN;

-- ── 1. Re-clean ───────────────────────────────────────────────────
WITH wnba_event_ids AS (
  SELECT e.id
  FROM events e
  JOIN leagues l ON l.id = e.league_id
  WHERE l.slug = 'nba'
    AND e.title ~* '\m(lynx|aces|liberty|fever|dream|mystics|storm|mercury|sparks|wings|sky|valkyries|tempo|sun)\M'
)
DELETE FROM events
WHERE id IN (SELECT id FROM wnba_event_ids);

-- ── 2. Trigger function ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION events_block_wnba_in_nba()
RETURNS TRIGGER AS $$
DECLARE
  league_slug_val TEXT;
BEGIN
  -- Lookup the league slug for the row being written.
  SELECT slug INTO league_slug_val FROM leagues WHERE id = NEW.league_id;
  IF league_slug_val IS NULL OR league_slug_val <> 'nba' THEN
    RETURN NEW;
  END IF;

  -- Word-boundary match against the WNBA mascot set. PostgreSQL's
  -- `\m` and `\M` are word-start / word-end anchors (equivalent to
  -- POSIX [[:<:]] / [[:>:]]).
  IF NEW.title ~* '\m(lynx|aces|liberty|fever|dream|mystics|storm|mercury|sparks|wings|sky|valkyries|tempo|sun)\M' THEN
    RAISE EXCEPTION 'Refusing to insert WNBA-titled event "%" into the NBA league. Adapter must classify this as WNBA (currently untracked) or skip the row.', NEW.title
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_block_wnba_in_nba_trigger ON events;
CREATE TRIGGER events_block_wnba_in_nba_trigger
  BEFORE INSERT OR UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION events_block_wnba_in_nba();

COMMIT;

-- ── How to verify ─────────────────────────────────────────────────
--   -- Should return 0
--   SELECT COUNT(*) FROM events e JOIN leagues l ON l.id = e.league_id
--    WHERE l.slug = 'nba'
--      AND e.title ~* '\m(lynx|aces|liberty|fever|dream|mystics|storm|mercury|sparks|wings|sky|valkyries|tempo|sun)\M';
--
--   -- Manual trigger test (should raise exception)
--   INSERT INTO events (title, start_time, status, league_id)
--   VALUES ('Minnesota Lynx vs Phoenix Mercury', NOW(), 'scheduled',
--           (SELECT id FROM leagues WHERE slug = 'nba'));
--   -- ERROR: Refusing to insert WNBA-titled event "Minnesota Lynx vs Phoenix Mercury"
--
-- ── Future expansion ──────────────────────────────────────────────
-- Same pattern can be applied to other league/non-canonical pairs
-- that keep leaking (NPB into MLB, NCAA into NHL, etc.). For each:
-- add a deny-list, install a separate trigger. This is more robust
-- than patching every adapter individually because it can't be
-- bypassed without explicit DB changes.
