/**
 * FanDuel Ontario adapter.
 *
 * Public API — uses _ak (API key) parameter. No auth headers needed.
 * Single endpoint returns events + markets + odds for an entire sport page.
 *
 * Base: sbapi.on.sportsbook.fanduel.ca
 * Key param: _ak=FhMFpcPWXMeyZxOx
 */

const BASE = 'https://sbapi.on.sportsbook.fanduel.ca/api'
const API_KEY = 'FhMFpcPWXMeyZxOx'

// FanDuel uses CUSTOM pages for major sports
export const FD_PAGES: { pageId: string; sport: string; leagueSlug: string; competitionId?: number }[] = [
  { pageId: 'nba',  sport: 'basketball', leagueSlug: 'nba' },
  { pageId: 'mlb',  sport: 'baseball',   leagueSlug: 'mlb' },
  { pageId: 'nhl',  sport: 'ice_hockey', leagueSlug: 'nhl' },
]

// Market type mapping
const MARKET_TYPE_MAP: Record<string, 'moneyline' | 'spread' | 'total'> = {
  'MONEY_LINE': 'moneyline',
  'MATCH_HANDICAP_(2-WAY)': 'spread',
  'TOTAL_POINTS_(OVER/UNDER)': 'total',
}

export interface FDEvent {
  eventId: string
  name: string
  homeName: string
  awayName: string
  startTime: string
  sport: string
  leagueSlug: string
}

export interface FDGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface FDResult {
  event: FDEvent
  gameMarkets: FDGameMarket[]
}

/**
 * Fetch all events + game markets for a FanDuel sport page.
 */
async function fetchPage(page: typeof FD_PAGES[number]): Promise<FDResult[]> {
  const url = `${BASE}/content-managed-page?page=CUSTOM&customPageId=${page.pageId}&_ak=${API_KEY}&timezone=America%2FToronto`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok) {
      console.error(`FanDuel ${page.pageId}: HTTP ${resp.status}`)
      return []
    }
    const data = await resp.json()

    const rawEvents = data.attachments?.events ?? {}
    const rawMarkets = data.attachments?.markets ?? {}

    // Build event map — only real game events (not futures/drafts)
    const eventMap = new Map<string, FDEvent>()
    for (const [id, ev] of Object.entries(rawEvents) as [string, any][]) {
      // Skip non-game events (futures, drafts, etc.)
      if (!ev.openDate || ev.name?.includes('Draft') || ev.name?.includes('Winner') || ev.name?.includes('MVP')) continue
      // Must have " @ " or " v " pattern indicating a game
      if (!ev.name?.includes(' @ ') && !ev.name?.includes(' v ')) continue

      const parts = ev.name.split(/\s+@\s+|\s+v\s+/)
      if (parts.length !== 2) continue

      const away = parts[0].trim()
      const home = parts[1].trim()

      eventMap.set(id, {
        eventId: id,
        name: ev.name,
        homeName: expandFDTeamName(home),
        awayName: expandFDTeamName(away),
        startTime: ev.openDate,
        sport: page.sport,
        leagueSlug: page.leagueSlug,
      })
    }

    // Parse markets and group by event
    const marketsByEvent = new Map<string, FDGameMarket[]>()

    for (const [, market] of Object.entries(rawMarkets) as [string, any][]) {
      const eventId = String(market.eventId)
      if (!eventMap.has(eventId)) continue

      const marketType = MARKET_TYPE_MAP[market.marketType]
      if (!marketType) continue

      const runners = market.runners ?? []
      let gm: FDGameMarket | null = null

      if (marketType === 'moneyline') {
        const home = runners.find((r: any) => r.result?.type === 'HOME')
        const away = runners.find((r: any) => r.result?.type === 'AWAY')
        const draw = runners.find((r: any) => r.result?.type === 'DRAW')
        gm = {
          marketType: 'moneyline',
          homePrice: home?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          awayPrice: away?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          drawPrice: draw?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        }
      } else if (marketType === 'spread') {
        const home = runners.find((r: any) => r.result?.type === 'HOME')
        const away = runners.find((r: any) => r.result?.type === 'AWAY')
        gm = {
          marketType: 'spread',
          homePrice: home?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          awayPrice: away?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          drawPrice: null,
          spreadValue: Math.abs(home?.handicap ?? away?.handicap ?? 0),
          totalValue: null, overPrice: null, underPrice: null,
        }
      } else if (marketType === 'total') {
        const over = runners.find((r: any) => r.result?.type === 'OVER')
        const under = runners.find((r: any) => r.result?.type === 'UNDER')
        gm = {
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: over?.handicap ?? under?.handicap ?? null,
          overPrice: over?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          underPrice: under?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
        }
      }

      if (gm) {
        if (!marketsByEvent.has(eventId)) marketsByEvent.set(eventId, [])
        marketsByEvent.get(eventId)!.push(gm)
      }
    }

    // Combine
    const results: FDResult[] = []
    for (const [eventId, event] of eventMap) {
      const gm = marketsByEvent.get(eventId) ?? []
      if (gm.length > 0) results.push({ event, gameMarkets: gm })
    }
    return results
  } catch (e) {
    console.error(`FanDuel ${page.pageId} error:`, e)
    return []
  }
}

// FanDuel team name normalization
function expandFDTeamName(name: string): string {
  // Strip parenthetical content: "Houston Astros (TBD)" → "Houston Astros"
  // Also handles pitcher names: "Houston Astros (J.Verlander)" → "Houston Astros"
  return name.replace(/\s*\([^)]*\)/g, '').trim()
}

/**
 * Full FanDuel scrape: all sport pages, one API call per page.
 */
export async function scrapeFanDuel(
  signal?: AbortSignal,
): Promise<FDResult[]> {
  const results = await Promise.all(
    FD_PAGES.map(page => fetchPage(page))
  )
  return results.flat()
}
