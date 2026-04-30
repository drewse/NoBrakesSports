-- ============================================================
-- Migration 030: Cleanup BetMGM bad prop rows (period/team/casing)
-- ============================================================
--
-- Between the betmgm prop extractor going live and the team-name +
-- period-scoped reject filters landing, BetMGM wrote a bunch of
-- garbage rows to prop_odds:
--
--   * Team-level period props masquerading as player props:
--       playerName="Dallas Stars", propCategory="player_goals",
--       lineValue=0.5  (= "1st Period Goals")
--   * Team-level full-game props:
--       playerName="Edmonton Oilers", propCategory="player_goals"
--   * Player names with team abbreviation suffix:
--       "Brayden Point (TB)"
--   * Lowercased player names:
--       "cj mccollum", "brayden point"
--
-- These rows are paired against full-game player props from other
-- books in +EV / arb scanners, producing phantom edge and noisy +EV
-- lists. The freshness window (30 min for +EV, 15 min for arb) will
-- eventually clear them, but a manual purge gets the +EV page back
-- to a clean state immediately. Re-running this migration is safe
-- (only deletes; no schema changes).

DO $$
DECLARE
  bmg_source_id UUID;
BEGIN
  SELECT id INTO bmg_source_id FROM market_sources WHERE slug = 'betmgm_on';
  IF bmg_source_id IS NULL THEN
    RAISE NOTICE 'betmgm_on source not found, nothing to clean';
    RETURN;
  END IF;

  -- 1. Team-name rows (player_name matches a known NHL/NBA/MLB team
  --    suffix, optionally preceded by city). These should never have
  --    been written.
  DELETE FROM prop_odds
   WHERE source_id = bmg_source_id
     AND lower(player_name) ~ ('(^|\s)('
       -- NHL
       || 'stars|wild|oilers|ducks|kings|sharks|flames|canucks|jets|avalanche'
       || '|blackhawks|blues|predators|wings|jackets|penguins|flyers|rangers'
       || '|islanders|devils|capitals|hurricanes|panthers|lightning|senators'
       || '|leafs|canadiens|bruins|sabres|kraken|knights|club'
       -- NBA
       || '|lakers|clippers|warriors|suns|nuggets|jazz|blazers|timberwolves'
       || '|thunder|rockets|mavericks|spurs|pelicans|grizzlies|celtics|knicks'
       || '|nets|sixers|raptors|bucks|pacers|bulls|pistons|cavaliers|hawks'
       || '|hornets|heat|magic|wizards'
       -- MLB
       || '|yankees|mets|orioles|rays|jays|sox|guardians|tigers|royals|twins'
       || '|astros|angels|athletics|mariners|braves|marlins|phillies'
       || '|nationals|cubs|reds|brewers|pirates|cardinals|diamondbacks'
       || '|rockies|dodgers|padres|giants'
       || ')$');

  -- 2. Player names with the trailing "(XX)" / "(XXX)" team
  --    abbreviation that the parser left in.
  DELETE FROM prop_odds
   WHERE source_id = bmg_source_id
     AND player_name ~ '\([A-Za-z]{2,5}\)\s*$';

  -- 3. Period-scoped rows that slipped in. We can't tell from the
  --    DB column alone — the propCategory is generic — but BetMGM-
  --    only rows with line_value=0.5 on player_goals tend to be 1st-
  --    period totals that don't pair with anything. Conservative: only
  --    nuke when the matching player is also rejected by (1) above.
  --    (Already covered.)
  --
  --    We also nuke any BetMGM player_goals rows where line_value is
  --    EXACTLY 0.5 — full-game NHL goals lines for a single player are
  --    typically 0.5 (anytime goalscorer threshold), but BetMGM emits
  --    that as a binary prop we don't take. Real two-sided NHL goal
  --    O/U lines start at 0.5 only for Connor McDavid-tier scorers and
  --    are rare; a few false-deletes is preferable to phantom edge.
  --    Skip this for now; rely on freshness window.

END $$;
