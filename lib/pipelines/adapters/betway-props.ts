/**
 * Betway Ontario adapter.
 *
 * Two-step API:
 *   1. GetGroup → event IDs (filtered by sport/league)
 *   2. GetEventsWithMultipleMarkets → game lines (filtered) + all markets (unfiltered for props)
 *
 * POST endpoints at betway.ca/ca-on/services/api/events/v2/
 * Odds returned as decimal (1.40 = -250 american)
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'

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
  props: NormalizedProp[]
}

// Betway MarketGroupCName → canonical prop category
// Groups from the API: points, rebounds, assists, 3-pointers, combos, defense
const BW_PROP_GROUPS: Record<string, string> = {
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  '3-pointers': 'player_threes',
  'threes': 'player_threes',
  // Baseball
  'hits': 'player_hits',
  'home-runs': 'player_home_runs',
  'rbis': 'player_rbis',
  'strikeouts': 'player_strikeouts_p',
  'pitcher-strikeouts': 'player_strikeouts_p',
  'total-bases': 'player_total_bases',
  'runs': 'player_runs',
  'stolen-bases': 'player_stolen_bases',
  // Hockey
  'goals': 'player_goals',
  'shots-on-goal': 'player_shots_on_goal',
  'saves': 'player_saves',
  // Soccer
  'shots-on-target': 'player_shots_target',
}

// For "combos" and "defense" groups, detect from Title
const BW_COMBO_KEYWORDS: Record<string, string> = {
  'pts + reb + ast': 'player_pts_reb_ast',
  'points + rebounds + assists': 'player_pts_reb_ast',
  'points, rebounds and assists': 'player_pts_reb_ast',
  'pts + rebs + asts': 'player_pts_reb_ast',
  'pts + reb': 'player_pts_reb',
  'points + rebounds': 'player_pts_reb',
  'pts + ast': 'player_pts_ast',
  'points + assists': 'player_pts_ast',
  'reb + ast': 'player_ast_reb',
  'rebounds + assists': 'player_ast_reb',
}

const BW_DEFENSE_KEYWORDS: Record<string, string> = {
  'steals': 'player_steals',
  'blocks': 'player_blocks',
  'steals + blocks': 'player_steals',
  'turnovers': 'player_turnovers',
}

/** Extract player name from a Betway prop market Title.
 *  Formats: "LaMelo Ball - Points Over/Under", "LaMelo Ball Points", "LaMelo Ball" */
function extractPlayerName(title: string, groupCName: string): string | null {
  // Strip common suffixes
  let cleaned = title
    .replace(/\s*over\s*\/?\s*under\s*/gi, '')
    .replace(/\s*o\s*\/?\s*u\s*/gi, '')
    .trim()

  // Try "Player Name - Stat" pattern
  const dashMatch = cleaned.match(/^(.+?)\s*-\s*(.+)$/)
  if (dashMatch) return dashMatch[1].trim()

  // For known single-stat groups, strip the stat name from the end
  const statSuffixes = ['points', 'rebounds', 'assists', '3-pointers', 'threes',
    'steals', 'blocks', 'hits', 'home runs', 'strikeouts', 'goals',
    'shots on goal', 'saves', 'total bases', 'runs', 'stolen bases', 'rbis']
  for (const suffix of statSuffixes) {
    if (cleaned.toLowerCase().endsWith(suffix)) {
      const name = cleaned.slice(0, -suffix.length).trim()
      if (name.length > 2) return name
    }
  }

  // If the group tells us the stat type, the Title might just be the player name
  if (BW_PROP_GROUPS[groupCName] && cleaned.length > 2 && cleaned.includes(' ')) {
    return cleaned
  }

  return null
}

/** Detect prop category for combo/defense groups from Title */
function detectComboOrDefense(title: string, groupCName: string): string | null {
  const lower = title.toLowerCase()
  if (groupCName === 'combos') {
    for (const [keyword, category] of Object.entries(BW_COMBO_KEYWORDS)) {
      if (lower.includes(keyword)) return category
    }
    // Default combos to PRA if we can't determine
    return 'player_pts_reb_ast'
  }
  if (groupCName === 'defense') {
    for (const [keyword, category] of Object.entries(BW_DEFENSE_KEYWORDS)) {
      if (lower.includes(keyword)) return category
    }
    // Default defense to steals
    return 'player_steals'
  }
  return null
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

      results.push({ event: bwEvent, gameMarkets, props: [] })
    }

    // ── Phase 2: Per-event fetch for ALL markets (props) ──
    // GetEventsWithMultipleMarkets without MarketCNames returns nothing,
    // so we fetch each event individually to get all markets + props.
    const resultsByEventId = new Map<number, BWResult>()
    for (const r of results) {
      resultsByEventId.set(r.event.eventId, r)
    }

    const PROP_BATCH = 5
    for (let i = 0; i < gameIds.length; i += PROP_BATCH) {
      const batch = gameIds.slice(i, i + PROP_BATCH)
      await Promise.all(
        batch.map(async (eventId: number) => {
          try {
            const evData = await postApi('GetEvent', {
              ...COMMON_BODY,
              EventId: eventId,
            })
            if (!evData || !evData.Markets) return

            // Build outcome map for this event
            const evOutcomeMap = new Map<number, any>()
            for (const o of evData.Outcomes ?? []) {
              evOutcomeMap.set(o.Id, o)
            }

            const result = resultsByEventId.get(eventId)
            if (!result) return

            for (const market of evData.Markets) {
              const groupCName: string = (market.MarketGroupCName ?? '').toLowerCase()

              // Determine prop category
              let propCategory = BW_PROP_GROUPS[groupCName]
              if (!propCategory && (groupCName === 'combos' || groupCName === 'defense')) {
                propCategory = detectComboOrDefense(market.Title ?? '', groupCName) ?? ''
              }
              if (!propCategory) continue

              // Extract player name
              const playerRaw = extractPlayerName(market.Title ?? '', groupCName)
              if (!playerRaw) continue

              // Get O/U outcomes
              const allOutcomeIds = (market.Outcomes ?? []).flat() as number[]
              const outcomes = allOutcomeIds.map((id: number) => evOutcomeMap.get(id)).filter(Boolean)

              const yesIds = new Set((market.OutcomeGroups?.yes?.outcomes ?? []) as number[])
              const noIds = new Set((market.OutcomeGroups?.no?.outcomes ?? []) as number[])

              let overOdds: number | null = null
              let underOdds: number | null = null

              for (const o of outcomes) {
                if (yesIds.has(o.Id) && o.OddsDecimal > 1) overOdds = decimalToAmerican(o.OddsDecimal)
                else if (noIds.has(o.Id) && o.OddsDecimal > 1) underOdds = decimalToAmerican(o.OddsDecimal)
              }
              // CouponName fallback
              if (overOdds == null || underOdds == null) {
                for (const o of outcomes) {
                  if (o.CouponName === 'Over' && o.OddsDecimal > 1) overOdds = decimalToAmerican(o.OddsDecimal)
                  if (o.CouponName === 'Under' && o.OddsDecimal > 1) underOdds = decimalToAmerican(o.OddsDecimal)
                }
              }

              if (overOdds == null && underOdds == null) continue
              const lineValue = market.Handicap ?? null
              if (lineValue == null) continue

              result.props.push({
                propCategory,
                playerName: normalizePlayerName(playerRaw),
                lineValue,
                overPrice: overOdds,
                underPrice: underOdds,
                yesPrice: null,
                noPrice: null,
                isBinary: false,
              })
            }
          } catch (e) {
            // Per-event fetch failed — skip this event's props
          }
        })
      )
    }

    const propCount = results.reduce((s, r) => s + r.props.length, 0)
    if (propCount > 0) {
      console.log(`[Betway] ${league.group}: ${propCount} player props from ${results.length} events`)
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
