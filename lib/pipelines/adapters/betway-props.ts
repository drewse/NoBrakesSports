/**
 * Betway Ontario adapter.
 *
 * Two-step API:
 *   1. GetGroup → event IDs (filtered by sport/league)
 *   2. GetEventsWithMultipleMarkets → full events + markets + outcomes with odds
 *
 * POST endpoints at betway.ca/ca-on/services/api/events/v2/
 * Odds returned as decimal (1.40 = -250 american)
 */

const BASE = 'https://betway.ca/ca-on/services/api/events/v2'
const COMMON_BODY = {
  BrandId: 3,
  LanguageId: 25,
  TerritoryId: 258,
  TerritoryCode: 'CA-ON',
  ClientTypeId: 1,
  ClientIntegratorId: 1,
  JurisdictionId: 20,
}

// Market CNames vary by sport — include all known variants
const MARKET_CNAMES = [
  'money-line',
  // Basketball/Football
  '-point-spread---0', '-total-points---0',
  // Baseball
  '-run-line---0', '-total-runs---0',
  // Hockey
  '-puck-line---0', '-total-goals---0',
  // Soccer
  'win-draw-win', '-total-goals---0',
]

export const BW_LEAGUES: { category: string; subCategory: string; group: string; leagueSlug: string }[] = [
  { category: 'basketball', subCategory: 'usa', group: 'nba',  leagueSlug: 'nba' },
  { category: 'baseball',   subCategory: 'usa', group: 'mlb',  leagueSlug: 'mlb' },
  { category: 'ice-hockey',  subCategory: 'usa', group: 'nhl',  leagueSlug: 'nhl' },
  { category: 'soccer',     subCategory: 'england', group: 'premier-league', leagueSlug: 'epl' },
  { category: 'soccer',     subCategory: 'spain', group: 'la-liga', leagueSlug: 'laliga' },
  { category: 'soccer',     subCategory: 'germany', group: 'bundesliga', leagueSlug: 'bundesliga' },
  { category: 'soccer',     subCategory: 'italy', group: 'serie-a', leagueSlug: 'seria_a' },
  { category: 'soccer',     subCategory: 'france', group: 'ligue-1', leagueSlug: 'ligue_one' },
]

export interface BWEvent {
  eventId: number
  homeName: string
  awayName: string
  startTime: string
  leagueSlug: string
  sport: string
}

export interface BWGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface BWResult {
  event: BWEvent
  gameMarkets: BWGameMarket[]
}

/** Convert decimal odds to American integer */
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

async function postApi(endpoint: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })
  if (!resp.ok) throw new Error(`Betway ${endpoint}: HTTP ${resp.status}`)
  return resp.json()
}

async function fetchLeague(league: typeof BW_LEAGUES[number]): Promise<BWResult[]> {
  try {
    // Step 1: GetGroup → event IDs
    const groupData = await postApi('GetGroup', {
      ...COMMON_BODY,
      CategoryCName: league.category,
      SubCategoryCName: league.subCategory,
      GroupCName: league.group,
      PremiumOnly: false,
    })

    if (!groupData.Success) return []

    const gameIds = (groupData.EventSummaries ?? [])
      .filter((e: any) => !e.IsOutright)
      .map((e: any) => e.EventId)

    if (gameIds.length === 0) return []

    // Step 2: GetEventsWithMultipleMarkets → full data
    const data = await postApi('GetEventsWithMultipleMarkets', {
      ...COMMON_BODY,
      EventMarketSets: [{ EventIds: gameIds, MarketCNames: MARKET_CNAMES }],
      ScoreboardRequest: { IncidentRequest: {}, ScoreboardType: 3 },
    })

    if (!data.Success || !data.Events) return []

    // Build outcome map: outcomeId → outcome
    const outcomeMap = new Map<number, any>()
    for (const o of data.Outcomes ?? []) {
      outcomeMap.set(o.Id, o)
    }

    // Build market map: marketId → market
    const marketsByEvent = new Map<number, any[]>()
    for (const m of data.Markets ?? []) {
      if (!marketsByEvent.has(m.EventId)) marketsByEvent.set(m.EventId, [])
      marketsByEvent.get(m.EventId)!.push(m)
    }

    // Parse results
    const results: BWResult[] = []
    for (const ev of data.Events) {
      if (ev.IsLive || ev.IsSuspended) continue

      const startMs = ev.Milliseconds
      const startTime = new Date(startMs).toISOString()

      const bwEvent: BWEvent = {
        eventId: ev.Id,
        homeName: ev.HomeTeamName,
        awayName: ev.AwayTeamName,
        startTime,
        leagueSlug: league.leagueSlug,
        sport: league.category,
      }

      const gameMarkets: BWGameMarket[] = []
      const evMarkets = marketsByEvent.get(ev.Id) ?? []

      for (const market of evMarkets) {
        // Get outcomes for this market
        const allOutcomeIds = (market.Outcomes ?? []).flat() as number[]
        const outcomes = allOutcomeIds.map(id => outcomeMap.get(id)).filter(Boolean)

        const homeOutcome = outcomes.find((o: any) => o.CouponName === 'Home')
        const awayOutcome = outcomes.find((o: any) => o.CouponName === 'Away')
        const overOutcome = outcomes.find((o: any) => o.CouponName === 'Over')
        const underOutcome = outcomes.find((o: any) => o.CouponName === 'Under')
        const drawOutcome = outcomes.find((o: any) => o.CouponName === 'Draw')

        const cname = (market.MarketCName as string).toLowerCase()
        const title = (market.Title as string).toLowerCase()

        if (cname === 'money-line' || cname === 'win-draw-win') {
          gameMarkets.push({
            marketType: 'moneyline',
            homePrice: homeOutcome ? decimalToAmerican(homeOutcome.OddsDecimal) : null,
            awayPrice: awayOutcome ? decimalToAmerican(awayOutcome.OddsDecimal) : null,
            drawPrice: drawOutcome ? decimalToAmerican(drawOutcome.OddsDecimal) : null,
            spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
          })
        } else if (cname.includes('point-spread') || cname.includes('run-line') || cname.includes('puck-line') || cname.includes('handicap')) {
          gameMarkets.push({
            marketType: 'spread',
            homePrice: homeOutcome ? decimalToAmerican(homeOutcome.OddsDecimal) : null,
            awayPrice: awayOutcome ? decimalToAmerican(awayOutcome.OddsDecimal) : null,
            drawPrice: null,
            spreadValue: Math.abs(market.Handicap ?? 0),
            totalValue: null, overPrice: null, underPrice: null,
          })
        } else if (cname.includes('total-points') || cname.includes('total-runs') || cname.includes('total-goals')) {
          gameMarkets.push({
            marketType: 'total',
            homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
            totalValue: market.Handicap ?? null,
            overPrice: overOutcome ? decimalToAmerican(overOutcome.OddsDecimal) : null,
            underPrice: underOutcome ? decimalToAmerican(underOutcome.OddsDecimal) : null,
          })
        }
      }

      if (gameMarkets.length > 0) {
        results.push({ event: bwEvent, gameMarkets })
      }
    }

    return results
  } catch (e) {
    console.error(`Betway ${league.group} error:`, e)
    return []
  }
}

/**
 * Full Betway scrape: all leagues, two API calls per league.
 */
export async function scrapeBetway(
  signal?: AbortSignal,
): Promise<BWResult[]> {
  const results = await Promise.all(
    BW_LEAGUES.map(league => fetchLeague(league))
  )
  return results.flat()
}
