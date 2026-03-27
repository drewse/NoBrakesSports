const BASE_URL = 'https://api.the-odds-api.com/v4'

// Maps The Odds API sport keys to our league slugs
export const SPORT_KEY_TO_LEAGUE: Record<string, string> = {
  americanfootball_nfl: 'nfl',
  basketball_nba: 'nba',
  baseball_mlb: 'mlb',
  icehockey_nhl: 'nhl',
  soccer_usa_mls: 'mls',
  americanfootball_ncaaf: 'ncaaf',
  basketball_ncaab: 'ncaab',
  soccer_epl: 'epl',
}

// Maps The Odds API bookmaker keys to our market_sources slugs
export const BOOKMAKER_TO_SOURCE: Record<string, string> = {
  draftkings: 'draftkings',
  fanduel: 'fanduel',
  betmgm: 'betmgm',
  williamhill_us: 'caesars',
  pinnacle: 'pinnacle',
  bet365: 'bet365',
  caesars: 'caesars',
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

export async function fetchOddsForSport(sportKey: string): Promise<OddsGame[]> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) throw new Error('ODDS_API_KEY is not set')

  const params = new URLSearchParams({
    apiKey,
    regions: 'us',
    markets: 'h2h,spreads,totals',
    oddsFormat: 'american',
    bookmakers: Object.keys(BOOKMAKER_TO_SOURCE).join(','),
  })

  const res = await fetch(`${BASE_URL}/sports/${sportKey}/odds?${params}`, {
    next: { revalidate: 0 },
  })

  if (res.status === 422) return [] // sport off-season / unavailable
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${await res.text()}`)

  return res.json()
}

export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100)
  return -odds / (-odds + 100)
}

// Map Odds API market key to our market_type enum
export function marketKeyToType(key: string): string {
  const map: Record<string, string> = {
    h2h: 'moneyline',
    spreads: 'spread',
    totals: 'total',
  }
  return map[key] ?? key
}
