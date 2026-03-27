-- ============================================================
-- NO BRAKES SPORTS — Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_market_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_blocks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_admin = TRUE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_pro_user()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND subscription_tier = 'pro'
    AND subscription_status = 'active'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- PROFILES
-- ============================================================

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT USING (is_admin());

CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE USING (is_admin());

-- ============================================================
-- SPORTS & LEAGUES (public read, admin write)
-- ============================================================

CREATE POLICY "Anyone can view active sports"
  ON sports FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage sports"
  ON sports FOR ALL USING (is_admin());

CREATE POLICY "Anyone can view active leagues"
  ON leagues FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage leagues"
  ON leagues FOR ALL USING (is_admin());

CREATE POLICY "Anyone can view active teams"
  ON teams FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage teams"
  ON teams FOR ALL USING (is_admin());

-- ============================================================
-- EVENTS
-- ============================================================

CREATE POLICY "Anyone can view events"
  ON events FOR SELECT USING (TRUE);

CREATE POLICY "Admins can manage events"
  ON events FOR ALL USING (is_admin());

-- ============================================================
-- MARKET SOURCES (public read, admin write)
-- ============================================================

CREATE POLICY "Anyone can view active sources"
  ON market_sources FOR SELECT USING (is_active = TRUE);

CREATE POLICY "Admins can manage sources"
  ON market_sources FOR ALL USING (is_admin());

-- ============================================================
-- MARKET SNAPSHOTS (gated by tier)
-- ============================================================

-- Free users: limited to recent data (last 24h)
CREATE POLICY "Free users can view recent snapshots"
  ON market_snapshots FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND snapshot_time > NOW() - INTERVAL '24 hours'
  );

-- Pro users: full access
CREATE POLICY "Pro users can view all snapshots"
  ON market_snapshots FOR SELECT
  USING (is_pro_user());

-- Admins: full access
CREATE POLICY "Admins can manage snapshots"
  ON market_snapshots FOR ALL USING (is_admin());

-- ============================================================
-- PREDICTION MARKET SNAPSHOTS
-- ============================================================

CREATE POLICY "Free users can view recent pred snapshots"
  ON prediction_market_snapshots FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND snapshot_time > NOW() - INTERVAL '24 hours'
  );

CREATE POLICY "Pro users can view all pred snapshots"
  ON prediction_market_snapshots FOR SELECT
  USING (is_pro_user());

CREATE POLICY "Admins can manage pred snapshots"
  ON prediction_market_snapshots FOR ALL USING (is_admin());

-- ============================================================
-- MARKET MAPPINGS
-- ============================================================

CREATE POLICY "Authenticated users can view mappings"
  ON market_mappings FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage mappings"
  ON market_mappings FOR ALL USING (is_admin());

-- ============================================================
-- WATCHLISTS
-- ============================================================

CREATE POLICY "Users can manage own watchlists"
  ON watchlists FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Admins can view all watchlists"
  ON watchlists FOR SELECT USING (is_admin());

CREATE POLICY "Users can manage own watchlist items"
  ON watchlist_items FOR ALL
  USING (
    watchlist_id IN (
      SELECT id FROM watchlists WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- ALERTS
-- ============================================================

CREATE POLICY "Users can manage own alerts"
  ON alerts FOR ALL USING (user_id = auth.uid());

CREATE POLICY "Admins can view all alerts"
  ON alerts FOR SELECT USING (is_admin());

CREATE POLICY "Users can view own alert triggers"
  ON alert_triggers FOR SELECT
  USING (
    alert_id IN (SELECT id FROM alerts WHERE user_id = auth.uid())
  );

-- ============================================================
-- NOTIFICATION PREFERENCES
-- ============================================================

CREATE POLICY "Users can manage own notification prefs"
  ON notification_preferences FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- FEATURE FLAGS
-- ============================================================

CREATE POLICY "Anyone can view feature flags"
  ON feature_flags FOR SELECT USING (TRUE);

CREATE POLICY "Admins can manage feature flags"
  ON feature_flags FOR ALL USING (is_admin());

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE POLICY "Users can view own audit logs"
  ON audit_logs FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all audit logs"
  ON audit_logs FOR SELECT USING (is_admin());

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT WITH CHECK (TRUE);

-- ============================================================
-- CONTENT BLOCKS
-- ============================================================

CREATE POLICY "Anyone can view published content"
  ON content_blocks FOR SELECT USING (is_published = TRUE);

CREATE POLICY "Admins can manage content"
  ON content_blocks FOR ALL USING (is_admin());
