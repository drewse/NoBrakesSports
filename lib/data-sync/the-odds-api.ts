const BASE_URL = 'https://api.the-odds-api.com/v4'

// Maps The Odds API sport keys to our league slugs.
// Source of truth for valid keys: GET /v4/sports?apiKey=KEY&all=true
export const SPORT_KEY_TO_LEAGUE: Record<string, string> = {
  // ── American Football ──────────────────────────────────────────────────────
  americanfootball_nfl:                        'nfl',
  americanfootball_ncaaf:                      'ncaaf',
  americanfootball_cfl:                        'cfl',
  americanfootball_ufl:                        'ufl',

  // ── Basketball ─────────────────────────────────────────────────────────────
  basketball_nba:                              'nba',
  basketball_ncaab:                            'ncaab',
  basketball_wncaab:                           'wncaab',
  basketball_euroleague:                       'euroleague',
  basketball_nbl:                              'nbl',

  // ── Baseball ───────────────────────────────────────────────────────────────
  baseball_mlb:                                'mlb',
  baseball_kbo:                                'kbo',
  baseball_npb:                                'npb',
  baseball_ncaa:                               'ncaa_baseball',

  // ── Ice Hockey ─────────────────────────────────────────────────────────────
  icehockey_nhl:                               'nhl',
  icehockey_ahl:                               'ahl',
  icehockey_sweden_hockey_league:              'shl',
  icehockey_sweden_allsvenskan:                'sweden_allsvenskan_hockey',
  icehockey_liiga:                             'liiga',
  icehockey_mestis:                            'mestis',

  // ── Soccer – Top Leagues ───────────────────────────────────────────────────
  soccer_epl:                                  'epl',
  soccer_usa_mls:                              'mls',
  soccer_spain_la_liga:                        'laliga',
  soccer_germany_bundesliga:                   'bundesliga',
  soccer_italy_serie_a:                        'seria_a',
  soccer_france_ligue_one:                     'ligue_one',
  soccer_netherlands_eredivisie:               'eredivisie',
  soccer_portugal_primeira_liga:               'liga_portugal',
  soccer_spl:                                  'spl',

  // ── Soccer – UEFA Competitions ────────────────────────────────────────────
  soccer_uefa_champs_league:                   'ucl',
  soccer_uefa_europa_league:                   'uel',
  soccer_uefa_europa_conference_league:        'uecl',
  soccer_uefa_champs_league_women:             'ucl_women',

  // ── Soccer – Cups ─────────────────────────────────────────────────────────
  soccer_fa_cup:                               'fa_cup',
  soccer_germany_dfb_pokal:                    'dfb_pokal',
  soccer_spain_copa_del_rey:                   'copa_del_rey',
  soccer_france_coupe_de_france:               'coupe_de_france',

  // ── Soccer – Second Tiers ─────────────────────────────────────────────────
  soccer_efl_champ:                            'efl_champ',
  soccer_england_league1:                      'efl_league1',
  soccer_england_league2:                      'efl_league2',
  soccer_germany_bundesliga2:                  'bundesliga2',
  soccer_germany_liga3:                        'bundesliga3',
  soccer_spain_segunda_division:               'la_liga2',
  soccer_france_ligue_two:                     'ligue_two',
  soccer_italy_serie_b:                        'serie_b',

  // ── Soccer – Rest of Europe ───────────────────────────────────────────────
  soccer_austria_bundesliga:                   'austria_bundesliga',
  soccer_belgium_first_div:                    'belgium_pro_a',
  soccer_denmark_superliga:                    'denmark_superliga',
  soccer_finland_veikkausliiga:                'finland_veikkaus',
  soccer_germany_bundesliga_women:             'frauen_bundesliga',
  soccer_greece_super_league:                  'greece_super',
  soccer_norway_eliteserien:                   'norway_eliteserien',
  soccer_poland_ekstraklasa:                   'ekstraklasa',
  soccer_russia_premier_league:                'russia_premier',
  soccer_sweden_allsvenskan:                   'sweden_allsvenskan',
  soccer_switzerland_superleague:              'swiss_super',
  soccer_turkey_super_league:                  'super_lig',

  // ── Soccer – Americas ─────────────────────────────────────────────────────
  soccer_brazil_campeonato:                    'brazil_serie_a',
  soccer_brazil_serie_b:                       'brazil_serie_b',
  soccer_argentina_primera_division:           'argentina_primera',
  soccer_conmebol_copa_libertadores:           'copa_libertadores',
  soccer_conmebol_copa_sudamericana:           'copa_sudamericana',
  soccer_chile_campeonato:                     'chile_primera',
  soccer_mexico_ligamx:                        'liga_mx',
  soccer_league_of_ireland:                    'league_of_ireland',

  // ── Soccer – Asia / Middle East / Other ──────────────────────────────────
  soccer_australia_aleague:                    'australia_aleague',
  soccer_japan_j_league:                       'j_league',
  soccer_korea_kleague1:                       'k_league1',
  soccer_china_superleague:                    'china_super',
  soccer_saudi_arabia_pro_league:              'saudi_pro',

  // ── Soccer – International ────────────────────────────────────────────────
  soccer_fifa_world_cup:                       'fifa_wc',
  soccer_fifa_world_cup_qualifiers_europe:     'wcq_europe',

  // ── Tennis – Grand Slams ──────────────────────────────────────────────────
  tennis_atp_aus_open_singles:                 'aus_open',
  tennis_wta_aus_open_singles:                 'aus_open',
  tennis_atp_french_open:                      'french_open',
  tennis_wta_french_open:                      'french_open',
  tennis_atp_wimbledon:                        'wimbledon',
  tennis_wta_wimbledon:                        'wimbledon',
  tennis_atp_us_open:                          'us_open_tennis',
  tennis_wta_us_open:                          'us_open_tennis',

  // ── Tennis – ATP Tournaments ──────────────────────────────────────────────
  tennis_atp_miami_open:                       'atp',
  tennis_atp_indian_wells:                     'atp',
  tennis_atp_canadian_open:                    'atp',
  tennis_atp_cincinnati_open:                  'atp',
  tennis_atp_madrid_open:                      'atp',
  tennis_atp_italian_open:                     'atp',
  tennis_atp_monte_carlo_masters:              'atp',
  tennis_atp_china_open:                       'atp',
  tennis_atp_qatar_open:                       'atp',
  tennis_atp_dubai:                            'atp',
  tennis_atp_shanghai_masters:                 'atp',
  tennis_atp_paris_masters:                    'atp',

  // ── Tennis – WTA Tournaments ──────────────────────────────────────────────
  tennis_wta_miami_open:                       'wta',
  tennis_wta_indian_wells:                     'wta',
  tennis_wta_canadian_open:                    'wta',
  tennis_wta_cincinnati_open:                  'wta',
  tennis_wta_madrid_open:                      'wta',
  tennis_wta_italian_open:                     'wta',
  tennis_wta_china_open:                       'wta',
  tennis_wta_qatar_open:                       'wta',
  tennis_wta_dubai:                            'wta',
  tennis_wta_wuhan_open:                       'wta',

  // ── MMA ────────────────────────────────────────────────────────────────────
  mma_mixed_martial_arts:                      'ufc',

  // ── Boxing ─────────────────────────────────────────────────────────────────
  boxing_boxing:                               'boxing_general',

  // ── Rugby League ──────────────────────────────────────────────────────────
  rugbyleague_nrl:                             'nrl',
  rugbyleague_nrl_state_of_origin:             'nrl_state_of_origin',

  // ── Rugby Union ───────────────────────────────────────────────────────────
  rugbyunion_six_nations:                      'six_nations',

  // ── Cricket ────────────────────────────────────────────────────────────────
  cricket_ipl:                                 'ipl',
  cricket_test_match:                          'ashes',
  cricket_big_bash:                            'bbl',
  cricket_psl:                                 'psl',

  // ── Aussie Rules ───────────────────────────────────────────────────────────
  aussierules_afl:                             'afl',

  // ── Handball ───────────────────────────────────────────────────────────────
  handball_germany_bundesliga:                 'handball_bundesliga',

  // ── Lacrosse ───────────────────────────────────────────────────────────────
  lacrosse_ncaa:                               'ncaa_lacrosse',
}

// Human-readable names for bookmaker keys returned by The Odds API.
// Used when auto-creating market_sources rows for books we haven't seen before.
// Keys are The Odds API bookmaker.key values; values are display names.
// This list covers every book The Odds API returns across us, us2, uk, eu, au, ca regions.
export const BOOKMAKER_DISPLAY_NAMES: Record<string, string> = {
  // US
  draftkings: 'DraftKings',
  fanduel: 'FanDuel',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
  williamhill_us: 'Caesars',
  betrivers: 'BetRivers',
  pointsbet_us: 'PointsBet',
  unibet_us: 'Unibet',
  betus: 'BetUS',
  mybookieag: 'MyBookie',
  bovada: 'Bovada',
  betonlineag: 'BetOnline',
  lowvig: 'LowVig',
  wynnbet: 'WynnBet',
  betparx: 'BetParx',
  hardrockbet: 'Hard Rock Bet',
  espnbet: 'ESPN Bet',
  fliff: 'Fliff',
  // US2
  betanysports: 'BetAnySports',
  superbook: 'SuperBook',
  circasports: 'Circa Sports',
  tipico_us: 'Tipico',
  si_sportsbook: 'SI Sportsbook',
  // UK / EU
  betfair_ex_eu: 'Betfair Exchange',
  betfair_sb_eu: 'Betfair Sportsbook',
  bet365: 'bet365',
  pinnacle: 'Pinnacle',
  unibet_eu: 'Unibet',
  williamhill: 'William Hill',
  skybet: 'Sky Bet',
  ladbrokes_uk: 'Ladbrokes',
  coral: 'Coral',
  paddypower: 'Paddy Power',
  betway: 'Betway',
  '888sport': '888sport',
  bwin: 'bwin',
  sport888: '888sport',
  matchbook: 'Matchbook',
  // AU
  tab: 'TAB',
  unibet: 'Unibet',
  sportsbet: 'Sportsbet',
  pointsbet: 'PointsBet',
  neds: 'Neds',
  betr_au: 'Betr',
  bluebet: 'BlueBet',
  ladbrokes: 'Ladbrokes',
  betfair_ex_au: 'Betfair Exchange',
  // CA / Ontario
  bet99: 'BET99',
  betway_ca: 'Betway',
  draftkings_ca: 'DraftKings',
  fanduel_ca: 'FanDuel',
  betano: 'Betano',
  betrivers_ca: 'BetRivers',
  pointsbet_ca: 'PointsBet',
  sports_interaction: 'Sports Interaction',
  caesars_ca: 'Caesars',
  betsafe: 'Betsafe',
  betvictor: 'BetVictor',
  betmgm_ca: 'BetMGM',
  proline: 'Proline',
  betcris: 'BetCris',
  northstar: 'NorthStar Bets',
  rivalry: 'Rivalry',
  thescore_bet: 'theScore Bet',
  tonybet: 'TonyBet',
  jackpotbet: 'Jackpot.bet',
  casumo: 'Casumo',
  leovegas: 'LeoVegas',
  bally_bet: 'Bally Bet',
  partypoker_ca: 'partypoker',
  betvictor_ca: 'BetVictor',
}

export interface OddsGame {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsBookmaker[]
}

export interface OddsBookmaker {
  key: string
  title: string
  last_update: string
  markets: OddsMarket[]
}

export interface OddsMarket {
  key: 'h2h' | 'spreads' | 'totals'
  last_update: string
  outcomes: OddsOutcome[]
}

export interface OddsOutcome {
  name: string
  price: number
  point?: number
}

/**
 * Returns the set of sport keys that are currently active (have live events)
 * according to The Odds API. Used to skip credits on off-season sports.
 */
export async function fetchActiveSportKeys(): Promise<Set<string>> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) throw new Error('ODDS_API_KEY is not set')

  const res = await fetch(`${BASE_URL}/sports?apiKey=${apiKey}`, {
    next: { revalidate: 0 },
  })
  if (!res.ok) return new Set() // fall back to fetching all on error

  const sports: Array<{ key: string; active: boolean }> = await res.json()
  return new Set(sports.filter(s => s.active).map(s => s.key))
}

/**
 * Fetch all available bookmakers for a sport across all supported regions.
 * We do NOT pass a bookmakers filter — The Odds API returns every book it has
 * for the given regions. New books appear automatically.
 *
 * Regions: us (main US books), us2 (secondary US), uk, eu, au
 */
export async function fetchOddsForSport(sportKey: string): Promise<OddsGame[]> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) throw new Error('ODDS_API_KEY is not set')

  // 6-region call: us + us2 (US majors + secondaries), eu (Pinnacle + EU
  // sharps), ca (Canadian books), uk (Sky Bet, Paddy Power, Coral,
  // Ladbrokes UK, William Hill UK, Matchbook, Betfair UK), au (Sportsbet,
  // TAB, Neds, Ladbrokes AU, Betfair AU, PointsBet AU). Each region adds
  // ~1 quota unit per sport call; uk/au together unlock ~30 books we
  // can't otherwise reach without proxy infra.
  const params = new URLSearchParams({
    apiKey,
    regions: 'us,us2,eu,ca,uk,au',
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american',
  })

  const res = await fetch(`${BASE_URL}/sports/${sportKey}/odds?${params}`, {
    next: { revalidate: 0 },
  })

  if (res.status === 422) return [] // sport off-season / unavailable
  if (!res.ok) throw new Error(`Odds API ${res.status} for ${sportKey}: ${await res.text()}`)

  return res.json()
}

/** Derive a URL-safe slug from a bookmaker key (already a slug format from The Odds API). */
export function bookmakerSlug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/g, '_')
}

/** Get a display name for a bookmaker key, falling back to title-casing the key. */
export function bookmakerDisplayName(key: string, apiTitle?: string): string {
  return BOOKMAKER_DISPLAY_NAMES[key] ?? apiTitle ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100)
  return -odds / (-odds + 100)
}

export function marketKeyToType(key: string): string {
  const map: Record<string, string> = {
    h2h: 'moneyline',
    spreads: 'spread',
    totals: 'total',
  }
  return map[key] ?? key
}
