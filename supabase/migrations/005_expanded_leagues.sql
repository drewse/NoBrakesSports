-- ============================================================
-- Migration 005: Expand leagues to match all Odds API sport keys
-- ============================================================

-- New sports
INSERT INTO sports (name, slug, display_order, is_active) VALUES
  ('Handball', 'handball', 13, TRUE),
  ('Lacrosse', 'lacrosse', 14, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- ── American Football ────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('UFL', 'ufl', 'UFL', 'US', 53)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'football'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Basketball ────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('WNCAAB',  'wncaab', 'WNCAAB', 'US', 42),
  ('NBL',     'nbl',    'NBL',    'AU', 43)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'basketball'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Baseball ─────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('KBO',          'kbo',          'KBO', 'KR', 11),
  ('NPB',          'npb',          'NPB', 'JP', 12),
  ('NCAA Baseball','ncaa_baseball','NCAAB','US', 13)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'baseball'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Ice Hockey ───────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('HockeyAllsvenskan', 'sweden_allsvenskan_hockey', 'ALLSV', 'SE', 62),
  ('Liiga',             'liiga',                     'LIIGA', 'FI', 63),
  ('Mestis',            'mestis',                    'MES',   'FI', 64)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'hockey'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Soccer – UEFA & Cups ──────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('UEFA Champions League Women', 'ucl_women',       'UCLW', 'EU', 33),
  ('FA Cup',                      'fa_cup',           'FAC',  'GB', 35),
  ('DFB-Pokal',                   'dfb_pokal',        'DFB',  'DE', 36),
  ('Copa del Rey',                'copa_del_rey',     'CDR',  'ES', 37),
  ('Coupe de France',             'coupe_de_france',  'CDF',  'FR', 38)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Soccer – Second Tiers ─────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('EFL Championship',  'efl_champ',   'CHAM', 'GB', 130),
  ('EFL League 1',      'efl_league1', 'L1',   'GB', 131),
  ('EFL League 2',      'efl_league2', 'L2',   'GB', 132),
  ('Bundesliga 2',      'bundesliga2', 'BL2',  'DE', 133),
  ('3. Liga',           'bundesliga3', 'BL3',  'DE', 134),
  ('La Liga 2',         'la_liga2',    'LL2',  'ES', 135),
  ('Ligue 2',           'ligue_two',   'L2F',  'FR', 136),
  ('Serie B',           'serie_b',     'SRB',  'IT', 137)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Soccer – Rest of Europe ───────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('Austrian Bundesliga',   'austria_bundesliga', 'ABL',  'AT', 140),
  ('Belgian Pro League A',  'belgium_pro_a',      'BPLA', 'BE', 141),
  ('Danish Superliga',      'denmark_superliga',  'DSL',  'DK', 142),
  ('Veikkausliiga',         'finland_veikkaus',   'VEI',  'FI', 143),
  ('Frauen-Bundesliga',     'frauen_bundesliga',  'FBL',  'DE', 144),
  ('Greek Super League',    'greece_super',       'GSL',  'GR', 145),
  ('Eliteserien',           'norway_eliteserien', 'ELT',  'NO', 146),
  ('Ekstraklasa',           'ekstraklasa',        'EKS',  'PL', 147),
  ('Russian Premier League','russia_premier',     'RPL',  'RU', 148),
  ('Allsvenskan',           'sweden_allsvenskan', 'ALV',  'SE', 149),
  ('Swiss Super League',    'swiss_super',        'SSL',  'CH', 150),
  ('Süper Lig',             'super_lig',          'SL',   'TR', 151)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Soccer – Americas ────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('Brazil Série B',         'brazil_serie_b',   'BSB',  'BR', 160),
  ('Copa Sudamericana',      'copa_sudamericana','CSUD', 'SA', 161),
  ('Primera División Chile', 'chile_primera',    'CHL',  'CL', 162),
  ('Liga MX',                'liga_mx',          'LMX',  'MX', 163),
  ('League of Ireland',      'league_of_ireland','LOI',  'IE', 164)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Soccer – Asia / Middle East ───────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('J1 League',         'j_league',   'J1',   'JP', 170),
  ('K League 1',        'k_league1',  'KL1',  'KR', 171),
  ('Chinese Super League','china_super','CSL', 'CN', 172),
  ('Saudi Pro League',  'saudi_pro',  'SPL',  'SA', 173)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Soccer – International ────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('FIFA World Cup',              'fifa_wc',     'WC',   'XX', 180),
  ('WC Qualifiers Europe',        'wcq_europe',  'WCQE', 'EU', 181)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Cricket ───────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('Pakistan Super League', 'psl', 'PSL', 'PK', 114)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'cricket'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Rugby League ─────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('NRL State of Origin', 'nrl_state_of_origin', 'SOO', 'AU', 105)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'rugby'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Handball ─────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('Handball Bundesliga', 'handball_bundesliga', 'HBL', 'DE', 10)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'handball'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Lacrosse ─────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('NCAA Lacrosse', 'ncaa_lacrosse', 'LACR', 'US', 10)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'lacrosse'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);
