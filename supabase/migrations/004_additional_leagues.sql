-- ============================================================
-- Migration 004: Add additional sports and leagues
-- ============================================================

-- Additional sports (sports table has unique slug constraint)
INSERT INTO sports (name, slug, display_order, is_active) VALUES
  ('Tennis',       'tennis',       7,  TRUE),
  ('Golf',         'golf',         8,  TRUE),
  ('Boxing',       'boxing',       9,  TRUE),
  ('Rugby',        'rugby',        10, TRUE),
  ('Cricket',      'cricket',      11, TRUE),
  ('Aussie Rules', 'aussie_rules', 12, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Helper: insert a league only if slug doesn't already exist
-- We use INSERT ... SELECT ... WHERE NOT EXISTS for each block

-- ── Soccer ────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('La Liga',                  'laliga',              'LaLiga',  'ES', 20),
  ('Bundesliga',               'bundesliga',          'BL',      'DE', 21),
  ('Serie A',                  'seria_a',             'SerieA',  'IT', 22),
  ('Ligue 1',                  'ligue_one',           'L1',      'FR', 23),
  ('UEFA Champions League',    'ucl',                 'UCL',     'EU', 24),
  ('UEFA Europa League',       'uel',                 'UEL',     'EU', 25),
  ('UEFA Conference League',   'uecl',                'UECL',    'EU', 26),
  ('Eredivisie',               'eredivisie',          'ERE',     'NL', 27),
  ('Liga Portugal',            'liga_portugal',       'LPT',     'PT', 28),
  ('Scottish Premiership',     'spl',                 'SPL',     'GB', 29),
  ('Brasileirao Serie A',      'brazil_serie_a',      'BSA',     'BR', 30),
  ('Argentina Primera',        'argentina_primera',   'ARG',     'AR', 31),
  ('Copa Libertadores',        'copa_libertadores',   'COPA',    'SA', 32),
  ('A-League',                 'australia_aleague',   'ALeague', 'AU', 34)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'soccer'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Basketball ────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('EuroLeague',   'euroleague',  'EURO',  'EU', 40),
  ('NBA G League', 'nba_gleague', 'NBAGL', 'US', 41)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'basketball'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── American Football ────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('CFL',  'cfl',  'CFL',  'CA', 50),
  ('XFL',  'xfl',  'XFL',  'US', 51),
  ('USFL', 'usfl', 'USFL', 'US', 52)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'football'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Ice Hockey ───────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('AHL', 'ahl', 'AHL', 'US', 60),
  ('SHL', 'shl', 'SHL', 'SE', 61)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'hockey'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Tennis ───────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('ATP Tour',        'atp',             'ATP',  'XX', 70),
  ('WTA Tour',        'wta',             'WTA',  'XX', 71),
  ('ATP Challenger',  'atp_challenger',  'ATPC', 'XX', 72),
  ('Australian Open', 'aus_open',        'AO',   'AU', 73),
  ('French Open',     'french_open',     'FO',   'FR', 74),
  ('Wimbledon',       'wimbledon',       'WIM',  'GB', 75),
  ('US Open Tennis',  'us_open_tennis',  'USO',  'US', 76),
  ('Davis Cup',       'davis_cup',       'DC',   'XX', 77)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'tennis'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Golf ─────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('PGA Tour',     'pga',          'PGA', 'US', 80),
  ('DP World Tour','dp_world',     'DPW', 'EU', 81),
  ('LIV Golf',     'liv_golf',     'LIV', 'XX', 82),
  ('The Masters',  'masters',      'MAS', 'US', 83),
  ('US Open Golf', 'us_open_golf', 'USG', 'US', 84)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'golf'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── MMA ───────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('UFC',              'ufc',     'UFC', 'US', 90),
  ('Bellator',         'bellator','BEL', 'US', 91),
  ('ONE Championship', 'one_fc',  'ONE', 'AS', 92)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'mma'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Boxing ───────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('Boxing', 'boxing_general', 'BOX', 'XX', 95)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'boxing'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Rugby ────────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('NRL',               'nrl',            'NRL', 'AU', 100),
  ('Super Rugby',       'super_rugby',    'SR',  'XX', 101),
  ('Premiership Rugby', 'premiership_ru', 'PRL', 'GB', 102),
  ('Six Nations',       'six_nations',    '6N',  'EU', 103)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'rugby'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Cricket ──────────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('IPL',          'ipl',   'IPL', 'IN', 110),
  ('The Ashes',    'ashes', 'ASH', 'AU', 111),
  ('T20 World Cup','t20_wc','T20', 'XX', 112),
  ('BBL',          'bbl',   'BBL', 'AU', 113)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'cricket'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);

-- ── Aussie Rules ─────────────────────────────────────────────────────────────
INSERT INTO leagues (sport_id, name, slug, abbreviation, country, display_order, is_active, is_premium)
SELECT s.id, v.name, v.slug, v.abbrev, v.country, v.ord, TRUE, TRUE
FROM sports s
CROSS JOIN (VALUES
  ('AFL', 'afl', 'AFL', 'AU', 120)
) AS v(name, slug, abbrev, country, ord)
WHERE s.slug = 'aussie_rules'
  AND NOT EXISTS (SELECT 1 FROM leagues l WHERE l.slug = v.slug);
