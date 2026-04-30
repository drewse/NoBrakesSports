/**
 * Sportsbook web URLs keyed by both display name (as it appears in
 * UnifiedArb / market_sources.name) and slug (as it appears in
 * market_sources.slug). Used by /arbitrage to deep-link the user
 * to each book's homepage / sportsbook landing.
 *
 * If a book's name/slug isn't in either table, getBookUrl() returns
 * null and the consumer should hide the click-through affordance.
 */

// Slug-keyed map (matches market_sources.slug). All keys are lowercased
// and underscore-separated where applicable.
const URL_BY_SLUG: Record<string, string> = {
  draftkings:          'https://sportsbook.draftkings.com/',
  fanduel:             'https://sportsbook.fanduel.com/',
  betmgm:              'https://sports.betmgm.com/',
  betmgm_on:           'https://sports.on.betmgm.ca/',
  caesars:             'https://www.caesars.com/sportsbook-and-casino',
  pointsbet:           'https://sportsbook.pointsbet.com/',
  pointsbet_on:        'https://on.pointsbet.ca/',
  betrivers:           'https://www.betrivers.com/',
  betrivers_on:        'https://on.betrivers.ca/',
  espnbet:             'https://espnbet.com/',
  hardrockbet:         'https://app.hardrock.bet/',
  fanatics:            'https://sportsbook.fanatics.com/',
  ballybet:            'https://play.ballybet.ca/',
  bet365:              'https://www.bet365.com/',
  pinnacle:            'https://www.pinnacle.com/en/',
  betway:              'https://betway.com/',
  betvictor:           'https://www.betvictor.com/',
  bet99:               'https://www.bet99.com/',
  northstarbets:       'https://www.northstarbets.ca/',
  proline:             'https://proline.olg.ca/',
  '888sport':          'https://www.888sport.ca/',
  bwin:                'https://sports.bwin.com/',
  partypoker:          'https://www.partysports.ca/',
  betano:              'https://www.betano.com/',
  leovegas:            'https://www.leovegas.com/',
  tonybet:             'https://tonybet.com/',
  sports_interaction:  'https://www.sportsinteraction.com/',
  thescore:            'https://thescore.bet/',
  miseojeu:            'https://miseojeu.lotoquebec.com/',
  jackpotbet:          'https://www.jackpotcity.com/',
  powerplay:           'https://www.powerplay.com/',
  betovo:              'https://www.betovo.com/',
  sportzino:           'https://www.sportzino.com/',
  titanplay:           'https://www.titanplay.com/',
  bovada:              'https://www.bovada.lv/sports',
  bodog:               'https://www.bodog.eu/sports',
  betus:               'https://www.betus.com.pa/',
  betonline:           'https://www.betonline.ag/sportsbook',
  lowvig:              'https://www.lowvig.ag/',
  mybookie:            'https://mybookie.ag/',
  bookmaker_eu:        'https://www.bookmaker.eu/',
  betanysports:        'https://www.betanysports.eu/',
  novig:               'https://novig.us/',
  prophet_exchange:    'https://prophetexchange.com/',
  prizepicks:          'https://app.prizepicks.com/',
  underdog:            'https://underdogfantasy.com/',
  sleeper:             'https://sleeper.com/picks',
  fliff:               'https://www.getfliff.com/',
  stake:               'https://stake.com/sports',
  kalshi:              'https://kalshi.com/markets',
  polymarket:          'https://polymarket.com/',
  fanaticsmarkets:     'https://markets.fanatics.com/',
}

// Display-name → slug. UnifiedArb stores market_sources.name (e.g. "BetMGM",
// "PROLINE+", "theScore Bet"); we redirect them to a slug so they share
// URL_BY_SLUG above.
const NAME_TO_SLUG: Record<string, string> = {
  'DraftKings':         'draftkings',
  'FanDuel':            'fanduel',
  'BetMGM':             'betmgm',
  'BetMGM ON':          'betmgm_on',
  'BetMGM (Ontario)':   'betmgm_on',
  'Caesars':            'caesars',
  'PointsBet':          'pointsbet',
  'PointsBet ON':       'pointsbet_on',
  'BetRivers':          'betrivers',
  'BetRivers ON':       'betrivers_on',
  'ESPN BET':           'espnbet',
  'Hard Rock Bet':      'hardrockbet',
  'Fanatics':           'fanatics',
  'Bally Bet':          'ballybet',
  'Pinnacle':           'pinnacle',
  'Betway':             'betway',
  'BetVictor':          'betvictor',
  'BET99':              'bet99',
  'NorthStar Bets':     'northstarbets',
  'PROLINE+':           'proline',
  'Betano':             'betano',
  'LeoVegas':           'leovegas',
  'TonyBet':            'tonybet',
  'Sports Interaction': 'sports_interaction',
  'theScore Bet':       'thescore',
  'theScore':           'thescore',
  'Bovada':             'bovada',
  'Bodog':              'bodog',
  'Novig':              'novig',
  'PrizePicks':         'prizepicks',
  'Underdog':           'underdog',
  'Sleeper Picks':      'sleeper',
  'Stake.com':          'stake',
  'Kalshi':             'kalshi',
  'Polymarket':         'polymarket',
  'Fanatics Markets':   'fanaticsmarkets',
}

export function getBookUrl(nameOrSlug: string | null | undefined): string | null {
  if (!nameOrSlug) return null
  // Direct slug hit.
  if (URL_BY_SLUG[nameOrSlug]) return URL_BY_SLUG[nameOrSlug]
  // Display-name redirect.
  const slug = NAME_TO_SLUG[nameOrSlug]
  if (slug && URL_BY_SLUG[slug]) return URL_BY_SLUG[slug]
  // Case-insensitive fallback (handles drift like 'BetMGM' vs 'betmgm').
  const lc = nameOrSlug.toLowerCase()
  if (URL_BY_SLUG[lc]) return URL_BY_SLUG[lc]
  for (const [k, v] of Object.entries(NAME_TO_SLUG)) {
    if (k.toLowerCase() === lc) return URL_BY_SLUG[v] ?? null
  }
  return null
}
