-- ============================================================
-- Migration 033: Drop BetMGM player_rebounds rows that were actually
--                Rebounds + Assists / Rebounds, Assists combos
-- ============================================================
--
-- The BetMGM combo-prop regex only matched "and" as the joiner. Markets
-- like "Sam Hauser - Rebounds + Assists" or "Kelly Oubre Jr Rebounds,
-- Assists" fell through the combo branches and got mis-categorised as
-- pure player_rebounds. Those rows then paired against other books'
-- real rebounds props at completely different lines, producing the
-- 8-14% phantom NBA rebounds arbs the user reported.
--
-- We can't tell from the DB row alone which of the betmgm_on
-- player_rebounds rows came from a combo market (the prop_category /
-- line_value columns don't carry the original market name). Conservative
-- purge: nuke ALL betmgm_on player_rebounds rows from the past hour so
-- the freshness window can refill them with the corrected parser.
--
-- The next worker cycle (~3 min) will re-write legit rows under the
-- correct categories. Same approach as migration 030 used for the
-- earlier team/period bug.

DELETE FROM prop_odds
 WHERE source_id IN (SELECT id FROM market_sources WHERE slug = 'betmgm_on')
   AND prop_category IN (
     'player_rebounds',
     'player_assists',
     'player_points',
     'player_pts_reb',
     'player_pts_ast',
     'player_ast_reb',
     'player_pts_reb_ast'
   )
   AND snapshot_time > NOW() - INTERVAL '1 hour';
