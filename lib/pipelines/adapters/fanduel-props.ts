/**
 * FanDuel Ontario adapter.
 *
 * Public API — uses _ak (API key) parameter. No auth headers needed.
 * League page: events + game markets (ML/spread/total) + binary props
 * Event page: player O/U props (PLAYER_X_TOTAL_POINTS, etc.)
 *
 * Base: sbapi.on.sportsbook.fanduel.ca
 * Key param: _ak=FhMFpcPWXMeyZxOx
 */

import {
  normalizePlayerName,
  type NormalizedProp,
} from '../prop-normalizer'

const BASE = 'https://sbapi.on.sportsbook.fanduel.ca/api'
const API_KEY = 'FhMFpcPWXMeyZxOx'

// FanDuel uses CUSTOM pages for major sports
export const FD_PAGES: { pageId: string; sport: string; leagueSlug: string; competitionId?: number }[] = [
  { pageId: 'nba',  sport: 'basketball', leagueSlug: 'nba' },
  { pageId: 'mlb',  sport: 'baseball',   leagueSlug: 'mlb' },
  { pageId: 'nhl',  sport: 'ice_hockey', leagueSlug: 'nhl' },
  { pageId: 'soccer/epl', sport: 'soccer', leagueSlug: 'epl' },
  { pageId: 'soccer/laliga', sport: 'soccer', leagueSlug: 'laliga' },
  { pageId: 'soccer/bundesliga', sport: 'soccer', leagueSlug: 'bundesliga' },
  { pageId: 'soccer/serie-a', sport: 'soccer', leagueSlug: 'seria_a' },
  { pageId: 'soccer/ligue-1', sport: 'soccer', leagueSlug: 'ligue_one' },
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
  props: NormalizedProp[]
}

// FanDuel stat type extraction from market name
// Market names: "Player Name - Points", "Player Name - Rebounds", etc.
const FD_STAT_MAP: Record<string, string> = {
  // Basketball
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  'made threes': 'player_threes',
  '3-point field goals': 'player_threes',
  'three pointers': 'player_threes',
  'blocks': 'player_blocks',
  'steals': 'player_steals',
  'turnovers': 'player_turnovers',
  'pts + reb + ast': 'player_pts_reb_ast',
  'pts + rebs + asts': 'player_pts_reb_ast',
  'points + rebounds + assists': 'player_pts_reb_ast',
  'points + rebounds': 'player_pts_reb',
  'pts + rebs': 'player_pts_reb',
  'pts + reb': 'player_pts_reb',
  'points + assists': 'player_pts_ast',
  'pts + asts': 'player_pts_ast',
  'pts + ast': 'player_pts_ast',
  'rebounds + assists': 'player_ast_reb',
  'rebs + asts': 'player_ast_reb',
  'reb + ast': 'player_ast_reb',
  // Baseball
  'hits': 'player_hits',
  'hits allowed': 'player_hits_allowed',
  'home runs': 'player_home_runs',
  'rbis': 'player_rbis',
  'runs batted in': 'player_rbis',
  'strikeouts': 'player_strikeouts_p',
  'pitcher strikeouts': 'player_strikeouts_p',
  'earned runs': 'player_earned_runs',
  'earned runs allowed': 'player_earned_runs',
  'total bases': 'player_total_bases',
  'runs': 'player_runs',
  'runs scored': 'player_runs',
  'stolen bases': 'player_stolen_bases',
  'walks': 'player_walks',
  'walks allowed': 'player_walks',
  'outs': 'pitcher_outs',
  'outs recorded': 'pitcher_outs',
  // Hockey
  'goals': 'player_goals',
  'hockey assists': 'player_hockey_assists',
  'hockey points': 'player_hockey_points',
  'shots on goal': 'player_shots_on_goal',
  'shots': 'player_shots_on_goal',
  'saves': 'player_saves',
  'power play points': 'player_power_play_pts',
  // Soccer
  'goals scored': 'player_soccer_goals',
  'shots on target': 'player_shots_target',
}

// Tabs to fetch for player props — each returns different stat types.
// Covers NBA, MLB, NHL, soccer. Unknown tabs return empty arrays safely.
const FD_PROP_TABS = [
  // NBA
  'popular',
  'player-points',
  'player-rebounds',
  'player-assists',
  'player-threes',
  'player-combos',
  'player-defense',
  // MLB — batter/pitcher props
  'batter-hits',
  'batter-home-runs',
  'batter-rbis',
  'batter-total-bases',
  'batter-runs',
  'batter-stolen-bases',
  'batter-walks',
  'batter-props',
  'pitcher-props',
  'pitcher-strikeouts',
  'pitcher-outs',
  'pitcher-walks',
  'home-runs',
  'hitter-props',
  // NHL
  'player-points-nhl',
  'player-goals',
  'player-shots',
  'goalie-saves',
]

/**
 * Fetch player props for a specific FanDuel event.
 * Fetches multiple tabs since each tab returns different stat types.
 */
async function fetchEventProps(eventId: string): Promise<NormalizedProp[]> {
  const allProps: NormalizedProp[] = []
  const seen = new Map<string, number>() // dedup by "player|category|line" → index in allProps

  // Fetch all tabs in parallel
  const tabResults = await Promise.allSettled(
    FD_PROP_TABS.map(async (tab) => {
      const url = `${BASE}/event-page?tab=${tab}&eventId=${eventId}&_ak=${API_KEY}&timezone=America%2FToronto`
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!resp.ok) return []
      const data = await resp.json()
      return parsePropsFromMarkets(data.attachments?.markets ?? {})
    })
  )

  for (const result of tabResults) {
    if (result.status !== 'fulfilled') continue
    for (const prop of result.value) {
      const key = `${prop.playerName}|${prop.propCategory}|${prop.lineValue}`
      const existing = seen.get(key)
      if (existing != null) {
        // Prefer the entry with both over AND under prices (full O/U market)
        // over a one-sided threshold entry that only has overPrice.
        const existingHasBoth = allProps[existing].overPrice != null && allProps[existing].underPrice != null
        const newHasBoth = prop.overPrice != null && prop.underPrice != null
        if (existingHasBoth || !newHasBoth) continue
        // New entry is more complete — replace the existing one
        allProps[existing] = prop
        continue
      }
      seen.set(key, allProps.length)
      allProps.push(prop)
    }
  }

  return allProps
}

/** Parse player O/U props from a FanDuel markets object */
function parsePropsFromMarkets(markets: Record<string, any>): NormalizedProp[] {
  const props: NormalizedProp[] = []

  for (const [, market] of Object.entries(markets) as [string, any][]) {
    const marketType = (market.marketType ?? '') as string
    const runners = market.runners ?? []

    // Match PLAYER_X_TOTAL_* or PITCHER_X_TOTAL_* O/U markets
    if ((marketType.startsWith('PLAYER_') || marketType.startsWith('PITCHER_')) && marketType.includes('TOTAL_') && runners.length === 2) {
      const overRunner = runners.find((r: any) => r.runnerName?.includes('Over'))
      const underRunner = runners.find((r: any) => r.runnerName?.includes('Under'))
      if (!overRunner && !underRunner) continue

      const marketName: string = market.marketName ?? ''
      const dashMatch = marketName.match(/^(.+?)\s*-\s*(.+)$/)
      if (!dashMatch) continue

      const playerName = normalizePlayerName(dashMatch[1].trim())
      const statRaw = dashMatch[2].trim().toLowerCase()
      const category = FD_STAT_MAP[statRaw]
      if (!playerName || !category) continue

      props.push({
        propCategory: category,
        playerName,
        lineValue: overRunner?.handicap ?? underRunner?.handicap ?? null,
        overPrice: overRunner?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
        underPrice: underRunner?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
        yesPrice: null,
        noPrice: null,
        isBinary: false,
      })
    }

    // ── Game-level "Total Hits" — emit as prop with player='Game' ──
    // FanDuel market types: TOTAL_HITS, TOTAL_GAME_HITS. Market name may be
    // "Total Hits" or "Total Game Hits" with Over/Under runners.
    const mtUpper = marketType.toUpperCase()
    const marketNameLower = (market.marketName ?? '').toLowerCase()
    if (
      (mtUpper === 'TOTAL_HITS' || mtUpper === 'TOTAL_GAME_HITS' ||
       marketNameLower === 'total hits' || marketNameLower === 'total game hits') &&
      runners.length === 2
    ) {
      const overR = runners.find((r: any) => r.runnerName?.includes('Over'))
      const underR = runners.find((r: any) => r.runnerName?.includes('Under'))
      const line = overR?.handicap ?? underR?.handicap ?? null
      if (line != null) {
        props.push({
          propCategory: 'game_total_hits',
          playerName: 'Game',
          lineValue: line,
          overPrice: overR?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          underPrice: underR?.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null,
          yesPrice: null, noPrice: null, isBinary: false,
        })
        continue
      }
    }

    // ── Threshold markets: "To Record N+ Hits", "To Hit N+ Home Runs", etc. ──
    // Convert to Over (N-0.5) with only the over_price.
    const thresholdMatch =
      marketType.match(/^PLAYER_TO_RECORD_(\d+)\+_(.+)$/i) ??
      marketType.match(/^TO_RECORD_(\d+)\+_(.+)$/i) ??
      marketType.match(/^TO_HIT_(\d+)\+_(.+)$/i) ??
      marketType.match(/^TO_SCORE_(\d+)\+_(.+)$/i) ??
      marketType.match(/^(\d+)\+_MADE_(.+)$/i) ??
      market.marketName?.match(/^(?:Player )?To (?:Record|Score|Hit) (\d+)\+\s+(.+)$/i)
    if (thresholdMatch && runners.length >= 1) {
      const threshold = parseInt(thresholdMatch[1], 10)
      const statRaw = thresholdMatch[2]
        .replace(/_/g, ' ')
        .replace(/\s*\(.*\)/, '')
        .trim()
        .toLowerCase()

      const FD_THRESHOLD_MAP: Record<string, string> = {
        // Basketball
        'steals': 'player_steals',
        'points': 'player_points',
        'rebounds': 'player_rebounds',
        'assists': 'player_assists',
        'blocks': 'player_blocks',
        'threes': 'player_threes',
        'made threes': 'player_threes',
        'three pointers': 'player_threes',
        // Baseball
        'hits': 'player_hits',
        'home runs': 'player_home_runs',
        'rbis': 'player_rbis',
        'rbi': 'player_rbis',
        'total bases': 'player_total_bases',
        'strikeouts': 'player_strikeouts_p',
        'runs': 'player_runs',
        'runs scored': 'player_runs',
        'stolen bases': 'player_stolen_bases',
        'walks': 'player_walks',
        'walks allowed': 'player_walks',
        'outs': 'pitcher_outs',
        'outs recorded': 'pitcher_outs',
      }
      const category = FD_THRESHOLD_MAP[statRaw]
      if (!category) continue

      const lineValue = threshold - 0.5 // "1+" → 0.5, "2+" → 1.5

      // Extract player name from market name: "To Record 2+ Steals" is per-market
      // but FanDuel groups all players in one market with multiple runners
      for (const runner of runners) {
        const runnerName = runner.runnerName ?? ''
        if (!runnerName || runnerName === 'Yes' || runnerName === 'No') continue

        const yesOdds = runner.winRunnerOdds?.americanDisplayOdds?.americanOddsInt ?? null
        if (yesOdds == null) continue

        props.push({
          propCategory: category,
          playerName: normalizePlayerName(runnerName),
          lineValue,
          overPrice: yesOdds, // "Yes to 1+ steals" = Over 0.5
          underPrice: null,
          yesPrice: null,
          noPrice: null,
          isBinary: false,
        })
      }
    }
  }

  return props
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
          // Signed spread from home team's perspective.
          spreadValue: home?.handicap != null ? home.handicap : (away?.handicap != null ? -away.handicap : 0),
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

    // Fetch player props for each event (parallel, batched)
    const propsByEvent = new Map<string, NormalizedProp[]>()
    const eventEntries = [...eventMap.entries()]
    const MAX_CONCURRENT = 5
    for (let i = 0; i < eventEntries.length; i += MAX_CONCURRENT) {
      const batch = eventEntries.slice(i, i + MAX_CONCURRENT)
      const batchProps = await Promise.all(
        batch.map(async ([eid]) => {
          const props = await fetchEventProps(eid)
          return { eid, props }
        })
      )
      for (const { eid, props } of batchProps) {
        if (props.length > 0) propsByEvent.set(eid, props)
      }
    }

    // Combine
    const results: FDResult[] = []
    for (const [eventId, event] of eventMap) {
      const gm = marketsByEvent.get(eventId) ?? []
      const props = propsByEvent.get(eventId) ?? []
      if (gm.length > 0 || props.length > 0) results.push({ event, gameMarkets: gm, props })
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
