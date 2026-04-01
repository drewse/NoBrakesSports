-- ── 1. Promote support@nobrakesmarket.com as admin ───────────────────────────
-- Updates the profile if the account already exists.
-- If the account does not exist yet, a trigger fires on signup (see below).
UPDATE profiles
SET is_admin = TRUE, updated_at = NOW()
WHERE email = 'support@nobrakesmarket.com';

-- Trigger: auto-promote this email on first signup so the account
-- is immediately admin even if it doesn't exist at migration time.
CREATE OR REPLACE FUNCTION promote_admin_on_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.email = 'support@nobrakesmarket.com' THEN
    NEW.is_admin := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_admin ON profiles;
CREATE TRIGGER trg_promote_admin
  BEFORE INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION promote_admin_on_signup();

-- ── 2. Disable The Odds API via feature flag ──────────────────────────────────
-- Insert a flag that the sync-odds cron checks before running.
-- Use INSERT ... ON CONFLICT so re-running the migration is safe.
INSERT INTO feature_flags (name, key, description, is_enabled, enabled_for_tiers)
VALUES (
  'The Odds API Sync',
  'odds_api_sync',
  'Enable / disable The Odds API cron ingestion. Turn off to pause all odds syncing.',
  FALSE,
  '{}'
)
ON CONFLICT (key) DO UPDATE
  SET is_enabled = FALSE, updated_at = NOW();

-- ── 3. data_pipelines table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_pipelines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  source_type         TEXT NOT NULL DEFAULT 'sportsbook',
  region              TEXT NOT NULL DEFAULT 'global',     -- 'us', 'ca', 'us_ca', 'ontario', 'global'
  is_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','inactive','healthy','warning','error')),
  priority            INT NOT NULL DEFAULT 50,            -- 1 = highest, 100 = lowest
  ingestion_method    TEXT,                               -- nullable; e.g. 'api', 'scraper', 'manual'
  health_status       TEXT NOT NULL DEFAULT 'unknown'
                        CHECK (health_status IN ('unknown','healthy','degraded','down')),
  notes               TEXT,
  last_checked_at     TIMESTAMPTZ,
  last_success_at     TIMESTAMPTZ,
  last_error_at       TIMESTAMPTZ,
  last_error_message  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE data_pipelines ENABLE ROW LEVEL SECURITY;

-- Only admins can read or write pipeline records
CREATE POLICY "Admins manage pipelines"
  ON data_pipelines FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ── 4. Seed pipeline records ──────────────────────────────────────────────────
-- 24 books from the provided list (Rivalry and Betsafe excluded).
-- All start as planned / inactive / disabled pending scraper implementation.
INSERT INTO data_pipelines
  (slug, display_name, source_type, region, is_enabled, status, priority, ingestion_method, health_status, notes)
VALUES
  ('fanduel',            'FanDuel',               'sportsbook', 'us_ca',   FALSE, 'planned', 10,  NULL, 'unknown', 'Largest US book by handle. Ontario available via FanDuel CA.'),
  ('draftkings',         'DraftKings',            'sportsbook', 'us_ca',   FALSE, 'planned', 10,  NULL, 'unknown', 'Top-tier US book with strong API-accessible odds history.'),
  ('betmgm',             'BetMGM',                'sportsbook', 'us_ca',   FALSE, 'planned', 15,  NULL, 'unknown', 'MGM partnership book. Wide US and Ontario footprint.'),
  ('caesars',            'Caesars',               'sportsbook', 'us_ca',   FALSE, 'planned', 15,  NULL, 'unknown', 'William Hill legacy. One of the big 4 US books.'),
  ('betrivers',          'BetRivers',             'sportsbook', 'us',      FALSE, 'planned', 20,  NULL, 'unknown', 'Rush Street Gaming. Strong US presence.'),
  ('bet365',             'bet365',                'sportsbook', 'global',  FALSE, 'planned', 20,  NULL, 'unknown', 'Global leader. Ontario and many international markets.'),
  ('pinnacle',           'Pinnacle',              'sportsbook', 'global',  FALSE, 'planned', 20,  NULL, 'unknown', 'Sharpest lines globally. Key consensus reference book.'),
  ('sports_interaction', 'Sports Interaction',    'sportsbook', 'ca',      FALSE, 'planned', 25,  NULL, 'unknown', 'Established Canadian book. Good CA market coverage.'),
  ('thescore',           'theScore Bet',          'sportsbook', 'ca',      FALSE, 'planned', 25,  NULL, 'unknown', 'theScore app integration. Ontario focused.'),
  ('pointsbet_on',       'PointsBet (Ontario)',   'sportsbook', 'ontario', FALSE, 'planned', 30,  NULL, 'unknown', 'Ontario-only since exiting US market.'),
  ('betway',             'Betway',                'sportsbook', 'ca',      FALSE, 'planned', 30,  NULL, 'unknown', 'Global book with strong Canadian presence.'),
  ('betvictor',          'BetVictor',             'sportsbook', 'ca',      FALSE, 'planned', 30,  NULL, 'unknown', 'UK heritage, Ontario licensed.'),
  ('bet99',              'BET99',                 'sportsbook', 'ca',      FALSE, 'planned', 30,  NULL, 'unknown', 'Canadian-first book. Growing Ontario market share.'),
  ('northstarbets',      'NorthStar Bets',        'sportsbook', 'ca',      FALSE, 'planned', 35,  NULL, 'unknown', 'Ontario-focused newer entrant.'),
  ('proline',            'Proline',               'sportsbook', 'ca',      FALSE, 'planned', 35,  NULL, 'unknown', 'OLG operated. Provincial lottery sportsbook.'),
  ('888sport',           '888sport',              'sportsbook', 'global',  FALSE, 'planned', 40,  NULL, 'unknown', 'Global book. Ontario and international markets.'),
  ('bwin',               'bwin',                  'sportsbook', 'global',  FALSE, 'planned', 40,  NULL, 'unknown', 'European-first book, Ontario licensed.'),
  ('betano',             'Betano',                'sportsbook', 'global',  FALSE, 'planned', 40,  NULL, 'unknown', 'Kaizen Gaming. Expanding Ontario footprint.'),
  ('leovegas',           'LeoVegas',              'sportsbook', 'global',  FALSE, 'planned', 45,  NULL, 'unknown', 'MGM owned. Mobile-first European/Ontario book.'),
  ('tonybet',            'TonyBet',               'sportsbook', 'global',  FALSE, 'planned', 45,  NULL, 'unknown', 'Lithuanian-origin book with Ontario presence.'),
  ('casumo',             'Casumo',                'sportsbook', 'global',  FALSE, 'planned', 45,  NULL, 'unknown', 'Nordic casino-to-sports crossover. Ontario licensed.'),
  ('ballybet',           'Bally Bet',             'sportsbook', 'us',      FALSE, 'planned', 50,  NULL, 'unknown', 'Bally Corp book. US states focus.'),
  ('partypoker',         'partypoker',            'sportsbook', 'global',  FALSE, 'planned', 50,  NULL, 'unknown', 'Entain brand. Poker-to-sports crossover.'),
  ('jackpotbet',         'Jackpot.bet',           'sportsbook', 'global',  FALSE, 'planned', 55,  NULL, 'unknown', 'Newer entrant. Global remit.')
ON CONFLICT (slug) DO NOTHING;
