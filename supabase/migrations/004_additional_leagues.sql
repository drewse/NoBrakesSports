-- ============================================================
-- Migration 004: Add additional sports and leagues
-- Covers all major Odds API sport keys beyond the initial 8
-- ============================================================

-- Additional sports
INSERT INTO sports (name, slug, display_order, is_active) VALUES
  ('Tennis',       'tennis',      7,  TRUE),
  ('Golf',         'golf',        8,  TRUE),
  ('Boxing',       'boxing',      9,  TRUE),
  ('Rugby',        'rugby',       10, TRUE),
  ('Cricket',      'cricket',     11, TRUE),
  ('Aussie Rules', 'aussie_rules',12, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- ── Soccer / Football ─────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('La Liga',                  'laliga',          'LaLiga',   'ES', 20),
  ('Bundesliga',               'bundesliga',      'BL',       'DE', 21),
  ('Serie A',                  'seria_a',         'SerieA',   'IT', 22),
  ('Ligue 1',                  'ligue_one',       'L1',       'FR', 23),
  ('UEFA Champions League',    'ucl',             'UCL',      'EU', 24),
  ('UEFA Europa League',       'uel',             'UEL',      'EU', 25),
  ('UEFA Conference League',   'uecl',            'UECL',     'EU', 26),
  ('Eredivisie',               'eredivisie',      'ERE',      'NL', 27),
  ('Liga Portugal',            'liga_portugal',   'LPT',      'PT', 28),
  ('Scottish Premiership',     'spl',             'SPL',      'GB', 29),
  ('Brasileirao Serie A',      'brazil_serie_a',  'BSA',      'BR', 30),
  ('Argentina Primera',        'argentina_primera','ARG',     'AR', 31),
  ('Copa Libertadores',        'copa_libertadores','COPA',    'SA', 32),
  ('AFC Champions League',     'afc_champions',   'AFC',      'AS', 33),
  ('A-League',                 'australia_aleague','ALeague', 'AU', 34),
  ('Soccer (Other)',           'soccer_other',    'SOC',      'XX', 99)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
ON CONFLICT (slug) DO NOTHING;

-- ── Basketball ────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('EuroLeague',              'euroleague',       'EURO',  'EU', 40),
  ('NBA G League',            'nba_gleague',      'NBAGL', 'US', 41),
  ('Basketball (Other)',      'basketball_other', 'BBALL', 'XX', 99)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'basketball'
ON CONFLICT (slug) DO NOTHING;

-- ── American Football ────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('CFL',   'cfl',   'CFL', 'CA', 50),
  ('XFL',   'xfl',   'XFL', 'US', 51),
  ('USFL',  'usfl',  'USFL','US', 52)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'football'
ON CONFLICT (slug) DO NOTHING;

-- ── Ice Hockey ───────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('AHL',             'ahl',         'AHL',  'US', 60),
  ('SHL',             'shl',         'SHL',  'SE', 61),
  ('KHL',             'khl',         'KHL',  'RU', 62),
  ('IIHF World Champ','iihf_wc',     'IIHF', 'XX', 63),
  ('Hockey (Other)',  'hockey_other','HOC',  'XX', 99)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'hockey'
ON CONFLICT (slug) DO NOTHING;

-- ── Tennis ───────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('ATP Tour',             'atp',          'ATP',  'XX', 70),
  ('WTA Tour',             'wta',          'WTA',  'XX', 71),
  ('ATP Challenger',       'atp_challenger','ATPC', 'XX', 72),
  ('Australian Open',      'aus_open',     'AO',   'AU', 73),
  ('French Open',          'french_open',  'FO',   'FR', 74),
  ('Wimbledon',            'wimbledon',    'WIM',  'GB', 75),
  ('US Open Tennis',       'us_open_tennis','USO', 'US', 76),
  ('Davis Cup',            'davis_cup',    'DC',   'XX', 77)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'tennis'
ON CONFLICT (slug) DO NOTHING;

-- ── Golf ─────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('PGA Tour',     'pga',       'PGA',  'US', 80),
  ('DP World Tour','dp_world',  'DPW',  'EU', 81),
  ('LIV Golf',     'liv_golf',  'LIV',  'XX', 82),
  ('The Masters',  'masters',   'MAS',  'US', 83),
  ('US Open Golf', 'us_open_golf','USG','US', 84)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'golf'
ON CONFLICT (slug) DO NOTHING;

-- ── MMA ───────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('UFC',         'ufc',         'UFC',  'US', 90),
  ('Bellator',    'bellator',    'BEL',  'US', 91),
  ('ONE Championship','one_fc',  'ONE',  'AS', 92)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'mma'
ON CONFLICT (slug) DO NOTHING;

-- ── Boxing ───────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('Boxing', 'boxing_general', 'BOX', 'XX', 95)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'boxing'
ON CONFLICT (slug) DO NOTHING;

-- ── Rugby ────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('NRL',              'nrl',          'NRL',  'AU', 100),
  ('Super Rugby',      'super_rugby',  'SR',   'XX', 101),
  ('Premiership Rugby','premiership_ru','PRL',  'GB', 102),
  ('Six Nations',      'six_nations',  '6N',   'EU', 103),
  ('Rugby World Cup',  'rugby_wc',     'RWC',  'XX', 104)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'rugby'
ON CONFLICT (slug) DO NOTHING;

-- ── Cricket ──────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('IPL',          'ipl',      'IPL', 'IN', 110),
  ('The Ashes',    'ashes',    'ASH', 'AU', 111),
  ('T20 World Cup','t20_wc',   'T20', 'XX', 112),
  ('BBL',          'bbl',      'BBL', 'AU', 113)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'cricket'
ON CONFLICT (slug) DO NOTHING;

-- ── Aussie Rules ─────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, l.name, l.slug, l.abbrev, l.country, l.ord, TRUE, TRUE
FROM sports s, (VALUES
  ('AFL', 'afl', 'AFL', 'AU', 120)
) AS l(name, slug, abbrev, country, ord)
WHERE s.slug = 'aussie_rules'
ON CONFLICT (slug) DO NOTHING;
