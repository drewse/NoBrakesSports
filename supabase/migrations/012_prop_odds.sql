-- ── 012_prop_odds.sql ─────────────────────────────────────────────────────────
--
-- Full prop market coverage for cross-book arbitrage and comparison.
--
-- Props have a fundamentally different shape from game-level markets:
--   game-level: "home vs away" (moneyline/spread/total) — keyed by market_type
--   props:      "Player X Over/Under 22.5 Points" — keyed by player + category + line
--
-- Data sources (free, unlimited):
--   - Kambi (BetRivers ON): ~4000 betOffers/day across NBA, MLB, NHL, Soccer
--   - Pinnacle:             ~2000 prop markets/day across the same sports
--
-- Volume: ~50k rows in prop_odds at steady state (with change detection).
-- Scanned every 2 minutes via Vercel cron.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. prop_odds — live current state ────────────────────────────────────────
-- ONE row per (event, source, prop_category, player_name, line_value).
-- This is the hot-path table for prop comparison and prop arbitrage pages.
-- Analogous to current_market_odds but for props.

CREATE TABLE IF NOT EXISTS prop_odds (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES market_sources(id) ON DELETE CASCADE,

  -- Prop identity: what is being bet on
  prop_category     TEXT NOT NULL,       -- e.g. 'player_points', 'player_rebounds', 'player_assists'
  player_name       TEXT NOT NULL,       -- normalized: "LeBron James", not "L. James"
  line_value        NUMERIC(10,2),       -- e.g. 22.5 (null for binary props like "anytime TD")

  -- Prices (American odds as integers, same as game-level)
  over_price        INT,                 -- Over line_value
  under_price       INT,                 -- Under line_value
  yes_price         INT,                 -- For binary props (anytime scorer, double-double)
  no_price          INT,                 -- For binary props

  -- Over/Under implied probabilities for arb detection
  over_implied_prob  NUMERIC(6,4),
  under_implied_prob NUMERIC(6,4),

  -- Change detection
  odds_hash         TEXT NOT NULL,        -- pipe-delimited fingerprint of prices

  -- Timestamps
  snapshot_time     TIMESTAMPTZ NOT NULL, -- last time we fetched (even if unchanged)
  changed_at        TIMESTAMPTZ NOT NULL, -- last time odds actually moved
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per prop line per book per event
  UNIQUE (event_id, source_id, prop_category, player_name, line_value)
);

ALTER TABLE prop_odds ENABLE ROW LEVEL SECURITY;

-- RLS: same tier gate as current_market_odds
CREATE POLICY "Free users can view recent prop odds"
  ON prop_odds FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND snapshot_time > NOW() - INTERVAL '24 hours'
  );

CREATE POLICY "Pro users can view all prop odds"
  ON prop_odds FOR SELECT
  USING (is_pro_user());

CREATE POLICY "Admins manage prop_odds"
  ON prop_odds FOR ALL
  USING (is_admin());

-- Indexes for the main query patterns
CREATE INDEX IF NOT EXISTS po_event_id_idx       ON prop_odds (event_id);
CREATE INDEX IF NOT EXISTS po_source_id_idx      ON prop_odds (source_id);
CREATE INDEX IF NOT EXISTS po_category_idx       ON prop_odds (prop_category);
CREATE INDEX IF NOT EXISTS po_player_name_idx    ON prop_odds (player_name);
-- Composite for prop comparison: "show me all books for Player X Points in Event Y"
CREATE INDEX IF NOT EXISTS po_event_cat_player_idx ON prop_odds (event_id, prop_category, player_name);
-- Composite for upsert conflict resolution
CREATE INDEX IF NOT EXISTS po_event_source_cat_player_line_idx
  ON prop_odds (event_id, source_id, prop_category, player_name, line_value);

-- ── 2. prop_snapshots — history log ──────────────────────────────────────────
-- Append-only: written only when odds_hash changes.
-- Same pattern as market_snapshots for game-level markets.

CREATE TABLE IF NOT EXISTS prop_snapshots (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id         UUID NOT NULL REFERENCES market_sources(id) ON DELETE CASCADE,
  prop_category     TEXT NOT NULL,
  player_name       TEXT NOT NULL,
  line_value        NUMERIC(10,2),
  over_price        INT,
  under_price       INT,
  yes_price         INT,
  no_price          INT,
  over_implied_prob  NUMERIC(6,4),
  under_implied_prob NUMERIC(6,4),
  odds_hash         TEXT NOT NULL,
  snapshot_time     TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Free users can view recent prop snapshots"
  ON prop_snapshots FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND snapshot_time > NOW() - INTERVAL '24 hours'
  );

CREATE POLICY "Pro users can view all prop snapshots"
  ON prop_snapshots FOR SELECT
  USING (is_pro_user());

CREATE POLICY "Admins manage prop_snapshots"
  ON prop_snapshots FOR ALL
  USING (is_admin());

CREATE INDEX IF NOT EXISTS ps_event_cat_player_time_idx
  ON prop_snapshots (event_id, prop_category, player_name, snapshot_time DESC);

-- ── 3. prop_categories — canonical prop type mapping ─────────────────────────
-- Maps raw criterion labels from each source to a canonical category.
-- This lets us compare "Points scored by the player" (Kambi) with
-- "Player Props: Points" (Pinnacle) as the same thing.

CREATE TABLE IF NOT EXISTS prop_categories (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name    TEXT NOT NULL UNIQUE,   -- 'player_points', 'player_rebounds', etc.
  display_name      TEXT NOT NULL,          -- 'Player Points', 'Player Rebounds'
  sport_slug        TEXT,                   -- null = all sports
  is_binary         BOOLEAN NOT NULL DEFAULT FALSE, -- true for "anytime TD", "double-double"
  sort_order        INT NOT NULL DEFAULT 100,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prop_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view prop categories"
  ON prop_categories FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage prop_categories"
  ON prop_categories FOR ALL
  USING (is_admin());

-- Seed the canonical prop categories
INSERT INTO prop_categories (canonical_name, display_name, sport_slug, is_binary, sort_order)
VALUES
  -- Basketball
  ('player_points',     'Player Points',       'basketball', FALSE, 10),
  ('player_rebounds',   'Player Rebounds',      'basketball', FALSE, 11),
  ('player_assists',    'Player Assists',       'basketball', FALSE, 12),
  ('player_threes',     'Player 3-Pointers',   'basketball', FALSE, 13),
  ('player_pts_reb_ast','Player PTS+REB+AST',  'basketball', FALSE, 14),
  ('player_steals',     'Player Steals',        'basketball', FALSE, 15),
  ('player_blocks',     'Player Blocks',        'basketball', FALSE, 16),
  ('player_turnovers',  'Player Turnovers',     'basketball', FALSE, 17),
  ('player_double_double', 'Double-Double',     'basketball', TRUE,  20),
  ('player_triple_double', 'Triple-Double',     'basketball', TRUE,  21),
  -- Baseball
  ('player_hits',           'Player Hits',              'baseball', FALSE, 30),
  ('player_home_runs',      'Player Home Runs',         'baseball', FALSE, 31),
  ('player_rbis',           'Player RBIs',              'baseball', FALSE, 32),
  ('player_strikeouts_p',   'Pitcher Strikeouts',       'baseball', FALSE, 33),
  ('player_earned_runs',    'Pitcher Earned Runs',      'baseball', FALSE, 34),
  ('player_total_bases',    'Player Total Bases',       'baseball', FALSE, 35),
  ('player_runs',           'Player Runs',              'baseball', FALSE, 36),
  ('player_stolen_bases',   'Player Stolen Bases',      'baseball', FALSE, 37),
  ('player_walks',          'Player Walks',             'baseball', FALSE, 38),
  ('player_hits_allowed',   'Pitcher Hits Allowed',     'baseball', FALSE, 39),
  ('pitcher_outs',          'Pitcher Outs Recorded',    'baseball', FALSE, 40),
  -- Hockey
  ('player_goals',          'Player Goals',             'ice_hockey', FALSE, 50),
  ('player_hockey_assists', 'Player Assists',           'ice_hockey', FALSE, 51),
  ('player_hockey_points',  'Player Points',            'ice_hockey', FALSE, 52),
  ('player_shots_on_goal',  'Player Shots on Goal',     'ice_hockey', FALSE, 53),
  ('player_saves',          'Goalie Saves',             'ice_hockey', FALSE, 54),
  ('player_power_play_pts', 'Power Play Points',        'ice_hockey', FALSE, 55),
  ('anytime_goal_scorer',   'Anytime Goal Scorer',      'ice_hockey', TRUE,  56),
  -- Soccer
  ('player_soccer_goals',   'Player Goals',             'soccer', FALSE, 70),
  ('player_soccer_assists', 'Player Assists',           'soccer', FALSE, 71),
  ('player_shots_target',   'Player Shots on Target',   'soccer', FALSE, 72),
  ('anytime_scorer',        'Anytime Goal Scorer',      'soccer', TRUE,  73),
  -- Game props (not player-specific — player_name = event team or 'game')
  ('team_total',         'Team Total',          NULL, FALSE, 90),
  ('half_spread',        '1st Half Spread',     NULL, FALSE, 91),
  ('half_total',         '1st Half Total',      NULL, FALSE, 92),
  ('quarter_total',      'Quarter Total',       NULL, FALSE, 93),
  ('first_to_score',     'First to Score X',    NULL, FALSE, 94),
  ('winning_margin',     'Winning Margin',      NULL, FALSE, 95)
ON CONFLICT (canonical_name) DO NOTHING;

-- ── 4. Pipeline tracking for prop sync ───────────────────────────────────────
-- Add prop-specific columns to pipeline_runs for tracking prop sync performance.
ALTER TABLE pipeline_runs
  ADD COLUMN IF NOT EXISTS props_changed  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS props_skipped  INT NOT NULL DEFAULT 0;
