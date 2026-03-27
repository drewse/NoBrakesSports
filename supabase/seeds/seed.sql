-- ============================================================
-- NO BRAKES SPORTS — Seed Data
-- ============================================================

-- Sports
INSERT INTO sports (id, name, slug, display_order, is_active) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Football', 'football', 1, TRUE),
  ('11111111-0000-0000-0000-000000000002', 'Basketball', 'basketball', 2, TRUE),
  ('11111111-0000-0000-0000-000000000003', 'Baseball', 'baseball', 3, TRUE),
  ('11111111-0000-0000-0000-000000000004', 'Hockey', 'hockey', 4, TRUE),
  ('11111111-0000-0000-0000-000000000005', 'Soccer', 'soccer', 5, TRUE),
  ('11111111-0000-0000-0000-000000000006', 'MMA', 'mma', 6, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Leagues
INSERT INTO leagues (id, sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001', 'NFL', 'nfl', 'NFL', 'US', 1, TRUE, FALSE),
  ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000002', 'NBA', 'nba', 'NBA', 'US', 2, TRUE, FALSE),
  ('22222222-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003', 'MLB', 'mlb', 'MLB', 'US', 3, TRUE, FALSE),
  ('22222222-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000004', 'NHL', 'nhl', 'NHL', 'US', 4, TRUE, FALSE),
  ('22222222-0000-0000-0000-000000000005', '11111111-0000-0000-0000-000000000005', 'MLS', 'mls', 'MLS', 'US', 5, TRUE, FALSE),
  ('22222222-0000-0000-0000-000000000006', '11111111-0000-0000-0000-000000000001', 'NCAAF', 'ncaaf', 'NCAAF', 'US', 6, TRUE, TRUE),
  ('22222222-0000-0000-0000-000000000007', '11111111-0000-0000-0000-000000000002', 'NCAAB', 'ncaab', 'NCAAB', 'US', 7, TRUE, TRUE),
  ('22222222-0000-0000-0000-000000000008', '11111111-0000-0000-0000-000000000005', 'EPL', 'epl', 'EPL', 'UK', 8, TRUE, TRUE)
ON CONFLICT DO NOTHING;

-- Teams (NFL sample)
INSERT INTO teams (id, league_id, name, slug, abbreviation, city) VALUES
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'Cowboys', 'cowboys', 'DAL', 'Dallas'),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'Eagles', 'eagles', 'PHI', 'Philadelphia'),
  ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', 'Giants', 'giants', 'NYG', 'New York'),
  ('33333333-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000001', 'Chiefs', 'chiefs', 'KC', 'Kansas City'),
  ('33333333-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000001', 'Patriots', 'patriots', 'NE', 'New England'),
  ('33333333-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000001', '49ers', '49ers', 'SF', 'San Francisco'),
  -- NBA
  ('33333333-0000-0000-0000-000000000007', '22222222-0000-0000-0000-000000000002', 'Lakers', 'lakers', 'LAL', 'Los Angeles'),
  ('33333333-0000-0000-0000-000000000008', '22222222-0000-0000-0000-000000000002', 'Celtics', 'celtics', 'BOS', 'Boston'),
  ('33333333-0000-0000-0000-000000000009', '22222222-0000-0000-0000-000000000002', 'Warriors', 'warriors', 'GSW', 'Golden State'),
  ('33333333-0000-0000-0000-000000000010', '22222222-0000-0000-0000-000000000002', 'Heat', 'heat', 'MIA', 'Miami')
ON CONFLICT DO NOTHING;

-- Market Sources
INSERT INTO market_sources (id, name, slug, source_type, website_url, is_active, health_status, display_order) VALUES
  ('44444444-0000-0000-0000-000000000001', 'DraftKings', 'draftkings', 'sportsbook', 'https://sportsbook.draftkings.com', TRUE, 'healthy', 1),
  ('44444444-0000-0000-0000-000000000002', 'FanDuel', 'fanduel', 'sportsbook', 'https://sportsbook.fanduel.com', TRUE, 'healthy', 2),
  ('44444444-0000-0000-0000-000000000003', 'BetMGM', 'betmgm', 'sportsbook', 'https://sports.betmgm.com', TRUE, 'healthy', 3),
  ('44444444-0000-0000-0000-000000000004', 'Caesars', 'caesars', 'sportsbook', 'https://sportsbook.caesars.com', TRUE, 'healthy', 4),
  ('44444444-0000-0000-0000-000000000005', 'Polymarket', 'polymarket', 'prediction_market', 'https://polymarket.com', TRUE, 'healthy', 5),
  ('44444444-0000-0000-0000-000000000006', 'Kalshi', 'kalshi', 'prediction_market', 'https://kalshi.com', TRUE, 'healthy', 6),
  ('44444444-0000-0000-0000-000000000007', 'Pinnacle', 'pinnacle', 'sportsbook', 'https://www.pinnacle.com', TRUE, 'healthy', 7),
  ('44444444-0000-0000-0000-000000000008', 'Bet365', 'bet365', 'sportsbook', 'https://www.bet365.com', TRUE, 'degraded', 8)
ON CONFLICT DO NOTHING;

-- Sample Events
INSERT INTO events (id, league_id, home_team_id, away_team_id, title, start_time, status, is_featured) VALUES
  (
    '55555555-0000-0000-0000-000000000001',
    '22222222-0000-0000-0000-000000000001',
    '33333333-0000-0000-0000-000000000004',
    '33333333-0000-0000-0000-000000000006',
    'Chiefs vs 49ers',
    NOW() + INTERVAL '3 days',
    'scheduled',
    TRUE
  ),
  (
    '55555555-0000-0000-0000-000000000002',
    '22222222-0000-0000-0000-000000000001',
    '33333333-0000-0000-0000-000000000002',
    '33333333-0000-0000-0000-000000000001',
    'Eagles vs Cowboys',
    NOW() + INTERVAL '5 days',
    'scheduled',
    TRUE
  ),
  (
    '55555555-0000-0000-0000-000000000003',
    '22222222-0000-0000-0000-000000000002',
    '33333333-0000-0000-0000-000000000007',
    '33333333-0000-0000-0000-000000000008',
    'Lakers vs Celtics',
    NOW() + INTERVAL '1 day',
    'scheduled',
    TRUE
  ),
  (
    '55555555-0000-0000-0000-000000000004',
    '22222222-0000-0000-0000-000000000002',
    '33333333-0000-0000-0000-000000000009',
    '33333333-0000-0000-0000-000000000010',
    'Warriors vs Heat',
    NOW() + INTERVAL '2 days',
    'scheduled',
    FALSE
  ),
  (
    '55555555-0000-0000-0000-000000000005',
    '22222222-0000-0000-0000-000000000001',
    '33333333-0000-0000-0000-000000000005',
    '33333333-0000-0000-0000-000000000003',
    'Patriots vs Giants',
    NOW() + INTERVAL '7 days',
    'scheduled',
    FALSE
  )
ON CONFLICT DO NOTHING;

-- Market Snapshots (sample data)
INSERT INTO market_snapshots (event_id, source_id, market_type, home_price, away_price, spread_value, home_implied_prob, away_implied_prob, movement_direction, movement_magnitude, snapshot_time) VALUES
  -- Chiefs vs 49ers - DraftKings
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'spread', -115, -105, -3.5, 0.535, 0.512, 'up', 0.5, NOW() - INTERVAL '1 hour'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'moneyline', -175, 145, NULL, 0.636, 0.408, 'up', 5.0, NOW() - INTERVAL '1 hour'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'total', NULL, NULL, 47.5, NULL, NULL, 'flat', 0.0, NOW() - INTERVAL '1 hour'),
  -- Chiefs vs 49ers - FanDuel
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'spread', -112, -108, -3.5, 0.528, 0.519, 'flat', 0.0, NOW() - INTERVAL '30 min'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000002', 'moneyline', -180, 150, NULL, 0.643, 0.400, 'up', 8.0, NOW() - INTERVAL '30 min'),
  -- Eagles vs Cowboys - DraftKings
  ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', 'spread', -110, -110, -2.5, 0.524, 0.524, 'flat', 0.0, NOW() - INTERVAL '2 hours'),
  ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000001', 'moneyline', -140, 118, NULL, 0.583, 0.458, 'down', 3.0, NOW() - INTERVAL '2 hours'),
  -- Lakers vs Celtics - DraftKings
  ('55555555-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', 'spread', -108, -112, -4.5, 0.519, 0.528, 'up', 1.5, NOW() - INTERVAL '45 min'),
  ('55555555-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000001', 'moneyline', -185, 155, NULL, 0.649, 0.392, 'flat', 0.0, NOW() - INTERVAL '45 min'),
  -- Lakers vs Celtics - FanDuel
  ('55555555-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002', 'spread', -110, -110, -4.5, 0.524, 0.524, 'up', 0.5, NOW() - INTERVAL '20 min'),
  -- Warriors vs Heat
  ('55555555-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', 'spread', -115, -105, -6.0, 0.535, 0.512, 'flat', 0.0, NOW() - INTERVAL '3 hours'),
  ('55555555-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000001', 'moneyline', -225, 185, NULL, 0.692, 0.351, 'down', 10.0, NOW() - INTERVAL '3 hours'),
  -- Pinnacle (sharper lines)
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000007', 'spread', -109, -109, -3.5, 0.521, 0.521, 'up', 1.0, NOW() - INTERVAL '15 min'),
  ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000007', 'moneyline', -170, 142, NULL, 0.630, 0.413, 'up', 6.0, NOW() - INTERVAL '15 min')
ON CONFLICT DO NOTHING;

-- Prediction Market Snapshots
INSERT INTO prediction_market_snapshots (event_id, source_id, contract_title, yes_price, no_price, yes_volume, total_volume, sportsbook_source_id, sportsbook_implied_prob, divergence_pct, snapshot_time) VALUES
  (
    '55555555-0000-0000-0000-000000000001',
    '44444444-0000-0000-0000-000000000005',
    'Will Chiefs win vs 49ers?',
    0.62, 0.38, 245000, 389000,
    '44444444-0000-0000-0000-000000000001',
    0.636, -1.6,
    NOW() - INTERVAL '30 min'
  ),
  (
    '55555555-0000-0000-0000-000000000001',
    '44444444-0000-0000-0000-000000000006',
    'Chiefs -3.5 Cover',
    0.48, 0.52, 88000, 156000,
    '44444444-0000-0000-0000-000000000001',
    0.535, -5.5,
    NOW() - INTERVAL '1 hour'
  ),
  (
    '55555555-0000-0000-0000-000000000003',
    '44444444-0000-0000-0000-000000000005',
    'Will Lakers win vs Celtics?',
    0.70, 0.30, 312000, 445000,
    '44444444-0000-0000-0000-000000000001',
    0.649, 5.1,
    NOW() - INTERVAL '20 min'
  ),
  (
    '55555555-0000-0000-0000-000000000002',
    '44444444-0000-0000-0000-000000000005',
    'Will Eagles win vs Cowboys?',
    0.56, 0.44, 178000, 302000,
    '44444444-0000-0000-0000-000000000001',
    0.583, -2.3,
    NOW() - INTERVAL '45 min'
  )
ON CONFLICT DO NOTHING;

-- Feature Flags
INSERT INTO feature_flags (key, name, description, is_enabled, enabled_for_tiers) VALUES
  ('advanced_filters', 'Advanced Filters', 'Enable advanced market filters', TRUE, '{pro}'),
  ('line_movement_charts', 'Line Movement Charts', 'Full historical sparkline charts', TRUE, '{pro}'),
  ('prediction_market_compare', 'Prediction Market Comparison', 'Side-by-side prediction vs sportsbook', TRUE, '{pro}'),
  ('alerts_system', 'Alerts System', 'Create and manage price movement alerts', TRUE, '{pro}'),
  ('export_data', 'Data Export', 'Export tables to CSV', TRUE, '{pro}'),
  ('historical_analytics', 'Historical Analytics', 'Access to full historical data', TRUE, '{pro}'),
  ('admin_panel', 'Admin Panel', 'Admin control panel access', FALSE, '{}'),
  ('beta_features', 'Beta Features', 'Early access to beta features', FALSE, '{}')
ON CONFLICT (key) DO NOTHING;

-- Historical snapshots for charts (last 7 days of fake movement data)
DO $$
DECLARE
  v_event_id UUID := '55555555-0000-0000-0000-000000000001';
  v_source_id UUID := '44444444-0000-0000-0000-000000000001';
  v_base_spread DECIMAL := -115;
  v_hours INT;
BEGIN
  FOR v_hours IN REVERSE 168..1 LOOP
    INSERT INTO market_snapshots (
      event_id, source_id, market_type,
      home_price, away_price, spread_value,
      home_implied_prob, away_implied_prob,
      movement_direction, movement_magnitude,
      snapshot_time
    ) VALUES (
      v_event_id, v_source_id, 'spread',
      v_base_spread + (random() * 10 - 5)::int,
      -(v_base_spread + (random() * 10 - 5)::int),
      -3.5 + (CASE WHEN random() > 0.8 THEN 0.5 ELSE 0 END * (CASE WHEN random() > 0.5 THEN 1 ELSE -1 END)),
      0.52 + (random() * 0.04 - 0.02),
      0.48 + (random() * 0.04 - 0.02),
      (CASE WHEN random() > 0.6 THEN 'up' WHEN random() > 0.3 THEN 'down' ELSE 'flat' END)::movement_direction,
      random() * 3,
      NOW() - (v_hours || ' hours')::INTERVAL
    );
  END LOOP;
END $$;
