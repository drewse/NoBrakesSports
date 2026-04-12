/**
 * DraftKings Ontario adapter.
 *
 * Public API — no auth, no proxy needed. HTTP 200 from curl/Vercel confirmed.
 *
 * Endpoints:
 *   Events list:  /sportscontent/pagedata/league/v1/leagues/{leagueId}
 *   Game markets:  /sportscontent/controldata/event/eventSubcategory/v1/markets?templateVars={eventId}&...subcategoryId=4511
 *   Player props:  same endpoint with prop subcategory IDs
 *
 * Site: CA-ON-SB (Ontario)
 */

import {
  normalizePlayerName,
  computePropOddsHash,
  americanToImpliedProb,
  type NormalizedProp,
} from '../prop-normalizer'

const BASE = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api'

// DraftKings league IDs
export const DK_LEAGUES: { sport: string; leagueId: string; leagueSlug: string; name: string }[] = [
  { sport: 'basketball', leagueId: '42648', leagueSlug: 'nba',         name: 'NBA' },
  { sport: 'baseball',   leagueId: '84240', leagueSlug: 'mlb',         name: 'MLB' },
  { sport: 'ice_hockey', leagueId: '42133', leagueSlug: 'nhl',         name: 'NHL' },
  { sport: 'soccer',     leagueId: '40253', leagueSlug: 'epl',         name: 'EPL' },
  { sport: 'soccer',     leagueId: '59974', leagueSlug: 'laliga',      name: 'La Liga' },
  { sport: 'soccer',     leagueId: '59979', leagueSlug: 'bundesliga',  name: 'Bundesliga' },
  { sport: 'soccer',     leagueId: '59977', leagueSlug: 'seria_a',     name: 'Serie A' },
  { sport: 'soccer',     leagueId: '59976', leagueSlug: 'ligue_one',   name: 'Ligue 1' },
]

// Subcategory IDs for market types
const GAME_LINES_SUBCATEGORY = '4511'

// DK team name abbreviations → full names
const DK_TEAM_NAMES: Record<string, string> = {
  'ATL Hawks': 'Atlanta Hawks', 'BOS Celtics': 'Boston Celtics', 'BKN Nets': 'Brooklyn Nets',
  'CHA Hornets': 'Charlotte Hornets', 'CHI Bulls': 'Chicago Bulls', 'CLE Cavaliers': 'Cleveland Cavaliers',
  'DAL Mavericks': 'Dallas Mavericks', 'DEN Nuggets': 'Denver Nuggets', 'DET Pistons': 'Detroit Pistons',
  'GS Warriors': 'Golden State Warriors', 'HOU Rockets': 'Houston Rockets', 'IND Pacers': 'Indiana Pacers',
  'LA Clippers': 'Los Angeles Clippers', 'LAL Lakers': 'Los Angeles Lakers',
  'MEM Grizzlies': 'Memphis Grizzlies', 'MIA Heat': 'Miami Heat', 'MIL Bucks': 'Milwaukee Bucks',
  'MIN Timberwolves': 'Minnesota Timberwolves', 'NO Pelicans': 'New Orleans Pelicans',
  'NY Knicks': 'New York Knicks', 'OKC Thunder': 'Oklahoma City Thunder', 'ORL Magic': 'Orlando Magic',
  'PHI 76ers': 'Philadelphia 76ers', 'PHX Suns': 'Phoenix Suns', 'POR Trail Blazers': 'Portland Trail Blazers',
  'SAC Kings': 'Sacramento Kings', 'SA Spurs': 'San Antonio Spurs', 'TOR Raptors': 'Toronto Raptors',
  'UTA Jazz': 'Utah Jazz', 'WAS Wizards': 'Washington Wizards',
  // MLB
  'NYY Yankees': 'New York Yankees', 'NYM Mets': 'New York Mets', 'BOS Red Sox': 'Boston Red Sox',
  'LA Dodgers': 'Los Angeles Dodgers', 'LA Angels': 'Los Angeles Angels', 'SF Giants': 'San Francisco Giants',
  'SD Padres': 'San Diego Padres', 'TB Rays': 'Tampa Bay Rays', 'KC Royals': 'Kansas City Royals',
  'STL Cardinals': 'St. Louis Cardinals', 'CWS White Sox': 'Chicago White Sox', 'CHI Cubs': 'Chicago Cubs',
  'CIN Reds': 'Cincinnati Reds', 'CLE Guardians': 'Cleveland Guardians', 'DET Tigers': 'Detroit Tigers',
  'HOU Astros': 'Houston Astros', 'MIL Brewers': 'Milwaukee Brewers', 'MIN Twins': 'Minnesota Twins',
  'OAK Athletics': 'Oakland Athletics', 'PHI Phillies': 'Philadelphia Phillies',
  'PIT Pirates': 'Pittsburgh Pirates', 'SEA Mariners': 'Seattle Mariners', 'TEX Rangers': 'Texas Rangers',
  'TOR Blue Jays': 'Toronto Blue Jays', 'WAS Nationals': 'Washington Nationals',
  'ATL Braves': 'Atlanta Braves', 'ARI Diamondbacks': 'Arizona Diamondbacks',
  'BAL Orioles': 'Baltimore Orioles', 'COL Rockies': 'Colorado Rockies', 'MIA Marlins': 'Miami Marlins',
}

function expandTeamName(dkName: string): string {
  return DK_TEAM_NAMES[dkName] ?? dkName
}

export interface DKEvent {
  eventId: string
  name: string
  homeName: string
  awayName: string
  startTime: string
  sport: string
  leagueSlug: string
}

export interface DKGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface DKResult {
  event: DKEvent
  gameMarkets: DKGameMarket[]
  props: NormalizedProp[]
}

/**
 * Fetch all events for a DK league.
 */
async function fetchLeagueEvents(leagueId: string, sport: string, leagueSlug: string): Promise<DKEvent[]> {
  const url = `${BASE}/sportscontent/pagedata/league/v1/leagues/${leagueId}`
  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const data = await resp.json()

    const events: DKEvent[] = []
    for (const ev of data.events ?? []) {
      if (ev.status !== 'NOT_STARTED') continue
      const home = ev.participants?.find((p: any) => p.venueRole === 'Home')
      const away = ev.participants?.find((p: any) => p.venueRole === 'Away')
      if (!home || !away) continue

      events.push({
        eventId: ev.id,
        name: ev.name,
        homeName: expandTeamName(home.name),
        awayName: expandTeamName(away.name),
        startTime: ev.startEventDate,
        sport,
        leagueSlug,
      })
    }
    return events
  } catch (e) {
    console.error(`DK league ${leagueId} fetch error:`, e)
    return []
  }
}

/**
 * Fetch game-level markets (ML, spread, total) for an event.
 */
async function fetchGameMarkets(eventId: string): Promise<DKGameMarket[]> {
  const query = `$filter=eventId eq '${eventId}' AND clientMetadata/subCategoryId eq '${GAME_LINES_SUBCATEGORY}' AND tags/all(t: t ne 'SportcastBetBuilder')`
  const url = `${BASE}/sportscontent/controldata/event/eventSubcategory/v1/markets?templateVars=${eventId}&marketsQuery=${encodeURIComponent(query)}&include=MarketSplits&entity=markets`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const data = await resp.json()

    const markets: DKGameMarket[] = []
    const marketsById = new Map<string, any>()
    for (const m of data.markets ?? []) {
      marketsById.set(m.id, m)
    }

    // Group selections by market
    const selectionsByMarket = new Map<string, any[]>()
    for (const s of data.selections ?? []) {
      const list = selectionsByMarket.get(s.marketId) ?? []
      list.push(s)
      selectionsByMarket.set(s.marketId, list)
    }

    for (const [marketId, market] of marketsById) {
      const selections = selectionsByMarket.get(marketId) ?? []
      const typeName = market.marketType?.name?.toLowerCase() ?? ''

      if (typeName === 'moneyline') {
        const home = selections.find((s: any) => s.outcomeType === 'Home')
        const away = selections.find((s: any) => s.outcomeType === 'Away')
        const draw = selections.find((s: any) => s.outcomeType === 'Draw')
        markets.push({
          marketType: 'moneyline',
          homePrice: parseAmerican(home?.displayOdds?.american),
          awayPrice: parseAmerican(away?.displayOdds?.american),
          drawPrice: parseAmerican(draw?.displayOdds?.american),
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      } else if (typeName === 'spread') {
        const home = selections.find((s: any) => s.outcomeType === 'Home')
        const away = selections.find((s: any) => s.outcomeType === 'Away')
        markets.push({
          marketType: 'spread',
          homePrice: parseAmerican(home?.displayOdds?.american),
          awayPrice: parseAmerican(away?.displayOdds?.american),
          drawPrice: null,
          spreadValue: home?.points ?? away?.points ? Math.abs(away?.points ?? home?.points) : null,
          totalValue: null, overPrice: null, underPrice: null,
        })
      } else if (typeName === 'total') {
        const over = selections.find((s: any) => s.outcomeType === 'Over')
        const under = selections.find((s: any) => s.outcomeType === 'Under')
        markets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: over?.points ?? under?.points ?? null,
          overPrice: parseAmerican(over?.displayOdds?.american),
          underPrice: parseAmerican(under?.displayOdds?.american),
        })
      }
    }
    return markets
  } catch (e) {
    console.error(`DK game markets ${eventId} error:`, e)
    return []
  }
}

/**
 * Parse DraftKings American odds string to integer.
 * DK uses unicode minus (−) not regular hyphen (-).
 */
function parseAmerican(odds: string | undefined | null): number | null {
  if (!odds) return null
  // Replace unicode minus with regular minus
  const cleaned = odds.replace(/\u2212/g, '-').replace(/\u002B/g, '+')
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? null : num
}

/**
 * Full DraftKings scrape: all leagues, all events, game-level markets.
 */
export async function scrapeDraftKings(
  signal?: AbortSignal,
): Promise<DKResult[]> {
  const results: DKResult[] = []

  // Fetch events for all leagues in parallel
  const leagueEvents = await Promise.all(
    DK_LEAGUES.map(league => fetchLeagueEvents(league.leagueId, league.sport, league.leagueSlug))
  )

  const allEvents = leagueEvents.flat()
  if (allEvents.length === 0) return results

  // Fetch game markets for each event with concurrency limit
  const MAX_CONCURRENT = 5
  for (let i = 0; i < allEvents.length; i += MAX_CONCURRENT) {
    if (signal?.aborted) break
    const batch = allEvents.slice(i, i + MAX_CONCURRENT)
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        const gameMarkets = await fetchGameMarkets(event.eventId)
        return { event, gameMarkets, props: [] as NormalizedProp[] }
      })
    )
    results.push(...batchResults)
  }

  return results
}
