const BASE_URL = 'https://api.the-odds-api.com/v4'

// Maps The Odds API sport keys to our league slugs
export const SPORT_KEY_TO_LEAGUE: Record<string, string> = {
  // ── American Football ──────────────────────────────────────────────────────
  americanfootball_nfl:               'nfl',
  americanfootball_ncaaf:             'ncaaf',
  americanfootball_cfl:               'cfl',

  // ── Basketball ─────────────────────────────────────────────────────────────
  basketball_nba:                     'nba',
  basketball_ncaab:                   'ncaab',
  basketball_euroleague:              'euroleague',

  // ── Baseball ───────────────────────────────────────────────────────────────
  baseball_mlb:                       'mlb',

  // ── Ice Hockey ─────────────────────────────────────────────────────────────
  icehockey_nhl:                      'nhl',
  icehockey_ahl:                      'ahl',
  icehockey_sweden_hockey_league:     'shl',

  // ── Soccer ─────────────────────────────────────────────────────────────────
  soccer_usa_mls:                     'mls',
  soccer_epl:                         'epl',
  soccer_spain_la_liga:               'laliga',
  soccer_germany_bundesliga:          'bundesliga',
  soccer_italy_serie_a:               'seria_a',
  soccer_france_ligue_one:            'ligue_one',
  soccer_uefa_champs_league:          'ucl',
  soccer_uefa_europa_league:          'uel',
  soccer_netherlands_eredivisie:      'eredivisie',
  soccer_portugal_primeira_liga:      'liga_portugal',
  soccer_brazil_campeonato:           'brazil_serie_a',
  soccer_argentina_primera_division:  'argentina_primera',
  soccer_conmebol_copa_libertadores:  'copa_libertadores',
  soccer_australia_aleague:           'australia_aleague',

  // ── Tennis ─────────────────────────────────────────────────────────────────
  tennis_atp_french_open:             'french_open',
  tennis_wta_french_open:             'french_open',
  tennis_atp_wimbledon:               'wimbledon',
  tennis_wta_wimbledon:               'wimbledon',
  tennis_atp_us_open:                 'us_open_tennis',
  tennis_wta_us_open:                 'us_open_tennis',
  // ── MMA ────────────────────────────────────────────────────────────────────
  mma_mixed_martial_arts:             'ufc',

  // ── Boxing ─────────────────────────────────────────────────────────────────
  boxing_boxing:                      'boxing_general',

  // ── Rugby ──────────────────────────────────────────────────────────────────
  rugbyleague_nrl:                    'nrl',
  rugbyunion_super_rugby:             'super_rugby',
  rugbyunion_six_nations:             'six_nations',

  // ── Cricket ────────────────────────────────────────────────────────────────
  cricket_ipl:                        'ipl',
  cricket_test_match:                 'ashes',
  cricket_big_bash:                   'bbl',

  // ── Aussie Rules ───────────────────────────────────────────────────────────
  aussierules_afl:                    'afl',
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
 * Fetch all available bookmakers for a sport across all supported regions.
 * We do NOT pass a bookmakers filter — The Odds API returns every book it has
 * for the given regions. New books appear automatically.
 *
 * Regions: us (main US books), us2 (secondary US), uk, eu, au, ca-on (Ontario)
 */
export async function fetchOddsForSport(sportKey: string): Promise<OddsGame[]> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) throw new Error('ODDS_API_KEY is not set')

  const params = new URLSearchParams({
    apiKey,
    regions: 'us,us2,uk,eu,au',
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
