-- ============================================================
-- NO BRAKES SPORTS — Initial Schema
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE subscription_status AS ENUM (
  'active', 'canceled', 'incomplete', 'incomplete_expired',
  'past_due', 'paused', 'trialing', 'unpaid'
);

CREATE TYPE subscription_tier AS ENUM ('free', 'pro');

CREATE TYPE market_type AS ENUM (
  'moneyline', 'spread', 'total', 'prop', 'futures', 'prediction'
);

CREATE TYPE alert_type AS ENUM (
  'line_movement', 'price_change', 'source_divergence', 'event_start'
);

CREATE TYPE alert_status AS ENUM ('active', 'triggered', 'paused', 'deleted');

CREATE TYPE notification_channel AS ENUM ('email', 'push', 'sms', 'in_app');

CREATE TYPE movement_direction AS ENUM ('up', 'down', 'flat');

-- ============================================================
-- USERS & PROFILES
-- ============================================================

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  username TEXT UNIQUE,
  bio TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  -- Subscription info (synced from Stripe)
  stripe_customer_id TEXT UNIQUE,
  subscription_id TEXT UNIQUE,
  subscription_status subscription_status DEFAULT 'active',
  subscription_tier subscription_tier DEFAULT 'free',
  subscription_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  -- Onboarding
  onboarding_completed BOOLEAN DEFAULT FALSE,
  favorite_sports TEXT[] DEFAULT '{}',
  favorite_leagues TEXT[] DEFAULT '{}',
  -- Meta
  is_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SPORTS & LEAGUES
-- ============================================================

CREATE TABLE sports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  icon_url TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE leagues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sport_id UUID NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  abbreviation TEXT,
  country TEXT,
  logo_url TEXT,
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  is_premium BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sport_id, slug)
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  abbreviation TEXT,
  city TEXT,
  logo_url TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, slug)
);

-- ============================================================
-- EVENTS
-- ============================================================

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  home_team_id UUID REFERENCES teams(id),
  away_team_id UUID REFERENCES teams(id),
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'scheduled', -- scheduled, live, completed, postponed, canceled
  home_score INT,
  away_score INT,
  external_id TEXT, -- ID from data provider
  source_metadata JSONB DEFAULT '{}',
  is_featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_league_id ON events(league_id);
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_status ON events(status);

-- ============================================================
-- MARKET SOURCES
-- ============================================================

CREATE TABLE market_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL, -- 'sportsbook', 'prediction_market', 'exchange'
  logo_url TEXT,
  website_url TEXT,
  api_endpoint TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  health_status TEXT DEFAULT 'unknown', -- healthy, degraded, down, unknown
  last_health_check TIMESTAMPTZ,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MARKET SNAPSHOTS (core price data)
-- ============================================================

CREATE TABLE market_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES market_sources(id) ON DELETE CASCADE,
  market_type market_type NOT NULL,
  -- Price data
  home_price DECIMAL(10, 4), -- American odds or decimal
  away_price DECIMAL(10, 4),
  draw_price DECIMAL(10, 4),
  spread_value DECIMAL(6, 2), -- e.g. -3.5
  total_value DECIMAL(6, 2),  -- e.g. 47.5
  over_price DECIMAL(10, 4),
  under_price DECIMAL(10, 4),
  -- Implied probabilities (0-1)
  home_implied_prob DECIMAL(6, 4),
  away_implied_prob DECIMAL(6, 4),
  -- Movement
  movement_direction movement_direction DEFAULT 'flat',
  movement_magnitude DECIMAL(8, 4) DEFAULT 0,
  -- Meta
  is_open BOOLEAN DEFAULT TRUE,
  raw_data JSONB DEFAULT '{}',
  snapshot_time TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_snapshots_event_id ON market_snapshots(event_id);
CREATE INDEX idx_market_snapshots_source_id ON market_snapshots(source_id);
CREATE INDEX idx_market_snapshots_snapshot_time ON market_snapshots(snapshot_time DESC);
CREATE INDEX idx_market_snapshots_market_type ON market_snapshots(market_type);

-- ============================================================
-- PREDICTION MARKET SNAPSHOTS
-- ============================================================

CREATE TABLE prediction_market_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES market_sources(id) ON DELETE CASCADE,
  -- Prediction market specific
  contract_title TEXT NOT NULL,
  external_contract_id TEXT,
  yes_price DECIMAL(6, 4),  -- 0-1 probability
  no_price DECIMAL(6, 4),
  yes_volume DECIMAL(18, 2),
  no_volume DECIMAL(18, 2),
  total_volume DECIMAL(18, 2),
  open_interest DECIMAL(18, 2),
  -- Comparison with sportsbook
  sportsbook_source_id UUID REFERENCES market_sources(id),
  sportsbook_implied_prob DECIMAL(6, 4),
  divergence_pct DECIMAL(8, 4), -- difference between pred market and sportsbook
  -- Movement
  prev_yes_price DECIMAL(6, 4),
  price_change_24h DECIMAL(8, 4),
  -- Meta
  is_resolved BOOLEAN DEFAULT FALSE,
  resolution_value BOOLEAN,
  snapshot_time TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pred_snapshots_event_id ON prediction_market_snapshots(event_id);
CREATE INDEX idx_pred_snapshots_source_id ON prediction_market_snapshots(source_id);
CREATE INDEX idx_pred_snapshots_snapshot_time ON prediction_market_snapshots(snapshot_time DESC);

-- ============================================================
-- MARKET MAPPINGS
-- ============================================================

CREATE TABLE market_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sportsbook_source_id UUID NOT NULL REFERENCES market_sources(id),
  prediction_source_id UUID NOT NULL REFERENCES market_sources(id),
  market_type market_type NOT NULL,
  mapping_confidence DECIMAL(4, 3) DEFAULT 1.0, -- 0-1 confidence score
  is_verified BOOLEAN DEFAULT FALSE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WATCHLISTS
-- ============================================================

CREATE TABLE watchlists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE watchlist_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  -- Can watch any of these entity types
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  source_id UUID REFERENCES market_sources(id) ON DELETE CASCADE,
  -- Notes
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_watchlist_items_unique ON watchlist_items(
  watchlist_id,
  COALESCE(team_id::text, ''),
  COALESCE(league_id::text, ''),
  COALESCE(event_id::text, ''),
  COALESCE(source_id::text, '')
);

-- ============================================================
-- ALERTS
-- ============================================================

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  alert_type alert_type NOT NULL,
  status alert_status DEFAULT 'active',
  -- Conditions (flexible JSONB)
  conditions JSONB NOT NULL DEFAULT '{}',
  -- e.g. for line_movement: { threshold: 3, direction: "any", market_type: "spread" }
  -- e.g. for divergence: { threshold_pct: 5, source_a: "uuid", source_b: "uuid" }
  -- Scope
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  source_id UUID REFERENCES market_sources(id) ON DELETE CASCADE,
  -- Delivery
  notification_channels notification_channel[] DEFAULT '{in_app}',
  -- Tracking
  trigger_count INT DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_user_id ON alerts(user_id);
CREATE INDEX idx_alerts_status ON alerts(status);

CREATE TABLE alert_triggers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  trigger_data JSONB DEFAULT '{}',
  notification_sent BOOLEAN DEFAULT FALSE,
  notification_sent_at TIMESTAMPTZ
);

-- ============================================================
-- NOTIFICATION PREFERENCES
-- ============================================================

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  email_alerts BOOLEAN DEFAULT TRUE,
  email_digest BOOLEAN DEFAULT TRUE,
  email_digest_frequency TEXT DEFAULT 'daily', -- 'instant', 'daily', 'weekly'
  push_alerts BOOLEAN DEFAULT FALSE,
  sms_alerts BOOLEAN DEFAULT FALSE,
  sms_number TEXT,
  in_app_alerts BOOLEAN DEFAULT TRUE,
  marketing_emails BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN DEFAULT FALSE,
  -- Override per user/tier
  enabled_for_tiers subscription_tier[] DEFAULT '{}',
  enabled_for_user_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  old_data JSONB,
  new_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ============================================================
-- CONTENT BLOCKS (admin-managed marketing content)
-- ============================================================

CREATE TABLE content_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  title TEXT,
  body TEXT,
  metadata JSONB DEFAULT '{}',
  is_published BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  updated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_market_sources_updated_at BEFORE UPDATE ON market_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_watchlists_updated_at BEFORE UPDATE ON watchlists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );

  -- Create default watchlist
  INSERT INTO watchlists (user_id, name, is_default)
  VALUES (NEW.id, 'My Watchlist', TRUE);

  -- Create default notification prefs
  INSERT INTO notification_preferences (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
