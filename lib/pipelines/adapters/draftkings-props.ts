/**
 * DraftKings Ontario adapter.
 *
 * Public API — no auth, no proxy needed. HTTP 200 from curl/Vercel confirmed.
 *
 * Single endpoint returns events + markets + selections for an entire league:
 *   /controldata/league/leagueSubcategory/v1/markets?templateVars={leagueId}&...
 *
 * Site: CA-ON-SB (Ontario)
 */

import { normalizePlayerName } from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent'
const GAME_LINES_SUBCATEGORY = '4511'

// DraftKings league IDs
export const DK_LEAGUES: { sport: string; leagueId: string; leagueSlug: string; name: string }[] = [
  { sport: 'basketball', leagueId: '42648',  leagueSlug: 'nba',         name: 'NBA' },
  { sport: 'baseball',   leagueId: '84240',  leagueSlug: 'mlb',         name: 'MLB' },
  { sport: 'ice_hockey', leagueId: '42133',  leagueSlug: 'nhl',         name: 'NHL' },
  { sport: 'soccer',     leagueId: '40253',  leagueSlug: 'epl',         name: 'EPL' },
  { sport: 'soccer',     leagueId: '59974',  leagueSlug: 'laliga',      name: 'La Liga' },
  { sport: 'soccer',     leagueId: '59979',  leagueSlug: 'bundesliga',  name: 'Bundesliga' },
  { sport: 'soccer',     leagueId: '59977',  leagueSlug: 'seria_a',     name: 'Serie A' },
  { sport: 'soccer',     leagueId: '59976',  leagueSlug: 'ligue_one',   name: 'Ligue 1' },
]

// DK team abbreviations → full names
const DK_TEAM_NAMES: Record<string, string> = {
  'ATL Hawks': 'Atlanta Hawks', 'BOS Celtics': 'Boston Celtics', 'BKN Nets': 'Brooklyn Nets',
  'CHA Hornets': 'Charlotte Hornets', 'CHI Bulls': 'Chicago Bulls', 'CLE Cavaliers': 'Cleveland Cavaliers',
  'DAL Mavericks': 'Dallas Mavericks', 'DEN Nuggets': 'Denver Nuggets', 'DET Pistons': 'Detroit Pistons',
  'GS Warriors': 'Golden State Warriors', 'HOU Rockets': 'Houston Rockets', 'IND Pacers': 'Indiana Pacers',
  'LA Clippers': 'Los Angeles Clippers', 'LA Lakers': 'Los Angeles Lakers', 'LAL Lakers': 'Los Angeles Lakers',
  'MEM Grizzlies': 'Memphis Grizzlies', 'MIA Heat': 'Miami Heat', 'MIL Bucks': 'Milwaukee Bucks',
  'MIN Timberwolves': 'Minnesota Timberwolves', 'NO Pelicans': 'New Orleans Pelicans',
  'NY Knicks': 'New York Knicks', 'OKC Thunder': 'Oklahoma City Thunder', 'ORL Magic': 'Orlando Magic',
  'PHI 76ers': 'Philadelphia 76ers', 'PHO Suns': 'Phoenix Suns', 'POR Trail Blazers': 'Portland Trail Blazers',
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
}

/**
 * Parse DraftKings American odds string to integer.
 * DK uses unicode minus (U+2212) and plus (U+002B).
 */
function parseAmerican(odds: string | undefined | null): number | null {
  if (!odds) return null
  const cleaned = odds.replace(/\u2212/g, '-').replace(/\u002B/g, '+')
  const num = parseInt(cleaned, 10)
  return isNaN(num) ? null : num
}

/**
 * Build the league subcategory URL that returns events + markets + selections in one call.
 */
function buildLeagueUrl(leagueId: string): string {
  const eventsQuery = `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${GAME_LINES_SUBCATEGORY}')`
  const marketsQuery = `$filter=clientMetadata/subCategoryId eq '${GAME_LINES_SUBCATEGORY}' AND tags/all(t: t ne 'SportcastBetBuilder')`
  return `${BASE}/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=${leagueId}&eventsQuery=${encodeURIComponent(eventsQuery)}&marketsQuery=${encodeURIComponent(marketsQuery)}&include=Events&entity=events`
}

/**
 * Fetch all events + game-level markets for a DK league in a single request.
 */
async function fetchLeague(
  league: typeof DK_LEAGUES[number],
): Promise<DKResult[]> {
  const url = buildLeagueUrl(league.leagueId)
  try {
    // Try direct fetch first, fall back to proxy if blocked
    let resp: Response
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!resp.ok && resp.status === 403) throw new Error('blocked')
    } catch {
      resp = await pipeFetch(url)
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      console.error(`DK league ${league.name}: HTTP ${resp.status} ${body.slice(0, 200)}`)
      return []
    }
    const data = await resp.json()

    // Build event map
    const eventMap = new Map<string, DKEvent>()
    for (const ev of data.events ?? []) {
      if (ev.status !== 'NOT_STARTED') continue
      const home = ev.participants?.find((p: any) => p.venueRole === 'Home')
      const away = ev.participants?.find((p: any) => p.venueRole === 'Away')
      if (!home || !away) continue

      eventMap.set(ev.id, {
        eventId: ev.id,
        name: ev.name,
        homeName: expandTeamName(home.name),
        awayName: expandTeamName(away.name),
        startTime: ev.startEventDate,
        sport: league.sport,
        leagueSlug: league.leagueSlug,
      })
    }

    // Group selections by market
    const selectionsByMarket = new Map<string, any[]>()
    for (const s of data.selections ?? []) {
      const list = selectionsByMarket.get(s.marketId) ?? []
      list.push(s)
      selectionsByMarket.set(s.marketId, list)
    }

    // Parse markets and attach to events
    const marketsByEvent = new Map<string, DKGameMarket[]>()
    for (const market of data.markets ?? []) {
      const eventId = market.eventId
      if (!eventMap.has(eventId)) continue

      const typeName = (market.marketType?.name ?? '').toLowerCase()
      const selections = selectionsByMarket.get(market.id) ?? []

      let gm: DKGameMarket | null = null

      if (typeName === 'moneyline') {
        const home = selections.find((s: any) => s.outcomeType === 'Home')
        const away = selections.find((s: any) => s.outcomeType === 'Away')
        const draw = selections.find((s: any) => s.outcomeType === 'Draw')
        gm = {
          marketType: 'moneyline',
          homePrice: parseAmerican(home?.displayOdds?.american),
          awayPrice: parseAmerican(away?.displayOdds?.american),
          drawPrice: parseAmerican(draw?.displayOdds?.american),
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        }
      } else if (typeName === 'spread') {
        const home = selections.find((s: any) => s.outcomeType === 'Home')
        const away = selections.find((s: any) => s.outcomeType === 'Away')
        const spreadVal = home?.points != null ? Math.abs(home.points) : (away?.points != null ? Math.abs(away.points) : null)
        gm = {
          marketType: 'spread',
          homePrice: parseAmerican(home?.displayOdds?.american),
          awayPrice: parseAmerican(away?.displayOdds?.american),
          drawPrice: null,
          spreadValue: spreadVal,
          totalValue: null, overPrice: null, underPrice: null,
        }
      } else if (typeName === 'total') {
        const over = selections.find((s: any) => s.outcomeType === 'Over')
        const under = selections.find((s: any) => s.outcomeType === 'Under')
        gm = {
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: over?.points ?? under?.points ?? null,
          overPrice: parseAmerican(over?.displayOdds?.american),
          underPrice: parseAmerican(under?.displayOdds?.american),
        }
      }

      if (gm) {
        if (!marketsByEvent.has(eventId)) marketsByEvent.set(eventId, [])
        marketsByEvent.get(eventId)!.push(gm)
      }
    }

    // Combine
    const results: DKResult[] = []
    for (const [eventId, event] of eventMap) {
      results.push({
        event,
        gameMarkets: marketsByEvent.get(eventId) ?? [],
      })
    }
    return results
  } catch (e) {
    console.error(`DK league ${league.name} error:`, e)
    return []
  }
}

/**
 * Full DraftKings scrape: all leagues, one API call per league.
 */
export async function scrapeDraftKings(
  signal?: AbortSignal,
): Promise<DKResult[]> {
  // Fetch all leagues in parallel
  const leagueResults = await Promise.all(
    DK_LEAGUES.map(league => fetchLeague(league))
  )
  return leagueResults.flat()
}
