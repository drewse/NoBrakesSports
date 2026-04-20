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

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent'

// DraftKings league IDs + game lines subcategory per sport
// Each sport uses a different subcategory ID for game lines (ML/spread/total)
export const DK_LEAGUES: { sport: string; leagueId: string; leagueSlug: string; name: string; subcategoryId: string }[] = [
  { sport: 'basketball', leagueId: '42648',  leagueSlug: 'nba',         name: 'NBA',        subcategoryId: '4511' },
  { sport: 'baseball',   leagueId: '84240',  leagueSlug: 'mlb',         name: 'MLB',        subcategoryId: '4519' },
  { sport: 'ice_hockey', leagueId: '42133',  leagueSlug: 'nhl',         name: 'NHL',        subcategoryId: '4515' },
  { sport: 'soccer',     leagueId: '40253',  leagueSlug: 'epl',         name: 'EPL',        subcategoryId: '4516' },
  { sport: 'soccer',     leagueId: '59974',  leagueSlug: 'laliga',      name: 'La Liga',    subcategoryId: '4516' },
  { sport: 'soccer',     leagueId: '59979',  leagueSlug: 'bundesliga',  name: 'Bundesliga', subcategoryId: '4516' },
  { sport: 'soccer',     leagueId: '59977',  leagueSlug: 'seria_a',     name: 'Serie A',    subcategoryId: '4516' },
  { sport: 'soccer',     leagueId: '59976',  leagueSlug: 'ligue_one',   name: 'Ligue 1',    subcategoryId: '4516' },
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
  props: NormalizedProp[]
}

// DK market type name → canonical prop category
const DK_PROP_MAP: Record<string, string> = {
  // Basketball
  'points': 'player_points',
  'total points': 'player_points',
  'rebounds': 'player_rebounds',
  'total rebounds': 'player_rebounds',
  'assists': 'player_assists',
  'total assists': 'player_assists',
  'made threes': 'player_threes',
  '3-pt field goals': 'player_threes',
  '3-point field goals made': 'player_threes',
  'threes': 'player_threes',
  'blocks': 'player_blocks',
  'total blocks': 'player_blocks',
  'steals': 'player_steals',
  'total steals': 'player_steals',
  'turnovers': 'player_turnovers',
  'total turnovers': 'player_turnovers',
  'pts + reb + ast': 'player_pts_reb_ast',
  'total pts + reb + ast': 'player_pts_reb_ast',
  'points + rebounds + assists': 'player_pts_reb_ast',
  'pts + rebs + asts': 'player_pts_reb_ast',
  'points + rebounds': 'player_pts_reb',
  'pts + rebs': 'player_pts_reb',
  'points + assists': 'player_pts_ast',
  'pts + asts': 'player_pts_ast',
  'rebounds + assists': 'player_ast_reb',
  'rebs + asts': 'player_ast_reb',
  // Baseball
  'hits': 'player_hits',
  'total hits': 'player_hits',
  'hits allowed': 'player_hits_allowed',
  'home runs': 'player_home_runs',
  'total home runs': 'player_home_runs',
  'rbis': 'player_rbis',
  'total rbis': 'player_rbis',
  'runs batted in': 'player_rbis',
  'total bases': 'player_total_bases',
  'runs': 'player_runs',
  'total runs scored': 'player_runs',
  'runs scored': 'player_runs',
  'stolen bases': 'player_stolen_bases',
  'total stolen bases': 'player_stolen_bases',
  'strikeouts': 'player_strikeouts_p',
  'total strikeouts': 'player_strikeouts_p',
  'pitcher strikeouts': 'player_strikeouts_p',
  'earned runs': 'player_earned_runs',
  'earned runs allowed': 'player_earned_runs',
  'walks allowed': 'player_walks',
  'outs': 'pitcher_outs',
  'outs recorded': 'pitcher_outs',
  // Hockey
  'goals': 'player_goals',
  'total goals': 'player_goals',
  'shots on goal': 'player_shots_on_goal',
  'total shots on goal': 'player_shots_on_goal',
  'saves': 'player_saves',
  'total saves': 'player_saves',
  'power play points': 'player_power_play_pts',
  // Soccer
  'shots on target': 'player_shots_target',
  'total shots on target': 'player_shots_target',
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
 * Build the URL for game-level markets (subcategory filtered — fast, reliable).
 */
function buildGameUrl(leagueId: string, subcategoryId: string): string {
  const eventsQuery = `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`
  const marketsQuery = `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`
  return `${BASE}/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=${leagueId}&eventsQuery=${encodeURIComponent(eventsQuery)}&marketsQuery=${encodeURIComponent(marketsQuery)}&include=Events&entity=events`
}

/**
 * Build URL for per-event prop markets using the eventSubcategory endpoint.
 * Discovered from DK DevTools: /controldata/event/eventSubcategory/v1/markets
 */
function buildEventPropUrl(eventId: string, subcategoryId: string): string {
  const marketsQuery = `$filter=eventId eq '${eventId}' AND clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`
  return `${BASE}/controldata/event/eventSubcategory/v1/markets?isBatchable=false&templateVars=${eventId}%2C${subcategoryId}&marketsQuery=${encodeURIComponent(marketsQuery)}&entity=markets`
}


/** Helper: fetch a DK URL with direct + proxy fallback */
async function dkFetch(url: string): Promise<Response> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok && resp.status === 403) throw new Error('blocked')
    return resp
  } catch {
    return pipeFetch(url)
  }
}

/** Parse events, game markets, and player props from a DK API response */
function parseLeagueData(data: any, league: typeof DK_LEAGUES[number]): DKResult[] {
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

  // Parse markets: game-level + player props
  const marketsByEvent = new Map<string, DKGameMarket[]>()
  const propsByEvent = new Map<string, NormalizedProp[]>()

  for (const market of data.markets ?? []) {
    const eventId = market.eventId
    if (!eventMap.has(eventId)) continue

    const typeName = (market.marketType?.name ?? '').toLowerCase()
    const selections = selectionsByMarket.get(market.id) ?? []

    // ── Game-level markets ──
    let gm: DKGameMarket | null = null

    if (typeName === 'moneyline' || typeName === 'money line') {
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
    } else if (typeName === 'spread' || typeName === 'run line' || typeName === 'puck line') {
      const home = selections.find((s: any) => s.outcomeType === 'Home')
      const away = selections.find((s: any) => s.outcomeType === 'Away')
      // Signed spread from home team's perspective.
      const spreadVal = home?.points != null ? home.points : (away?.points != null ? -away.points : null)
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
    } else if (typeName === 'total hits' || typeName === 'total game hits') {
      // Game-level "Total Hits" — emit as prop with player='Game'
      const over = selections.find((s: any) => s.outcomeType === 'Over')
      const under = selections.find((s: any) => s.outcomeType === 'Under')
      const lineValue = over?.points ?? under?.points ?? null
      if (lineValue != null && lineValue > 0) {
        if (!propsByEvent.has(eventId)) propsByEvent.set(eventId, [])
        propsByEvent.get(eventId)!.push({
          propCategory: 'game_total_hits',
          playerName: 'Game',
          lineValue,
          overPrice: parseAmerican(over?.displayOdds?.american),
          underPrice: parseAmerican(under?.displayOdds?.american),
          yesPrice: null, noPrice: null, isBinary: false,
        })
      }
      continue
    }

    if (gm) {
      if (!marketsByEvent.has(eventId)) marketsByEvent.set(eventId, [])
      marketsByEvent.get(eventId)!.push(gm)
      continue
    }

    // ── Player props (O/U markets with 2 selections) ──
    const propCategory = DK_PROP_MAP[typeName]
    if (propCategory && selections.length === 2) {
      const overSel = selections.find((s: any) => s.outcomeType === 'Over')
      const underSel = selections.find((s: any) => s.outcomeType === 'Under')
      if (!overSel && !underSel) continue

      // market.name contains the player name (e.g., "LeBron James")
      const playerRaw = (market.name ?? '').trim()
      if (!playerRaw) continue

      const lineValue = overSel?.points ?? underSel?.points ?? null
      if (lineValue == null) continue

      if (!propsByEvent.has(eventId)) propsByEvent.set(eventId, [])
      propsByEvent.get(eventId)!.push({
        propCategory,
        playerName: normalizePlayerName(playerRaw),
        lineValue,
        overPrice: parseAmerican(overSel?.displayOdds?.american),
        underPrice: parseAmerican(underSel?.displayOdds?.american),
        yesPrice: null,
        noPrice: null,
        isBinary: false,
      })
    }
  }

  // Combine
  const results: DKResult[] = []
  eventMap.forEach((event, eventId) => {
    results.push({
      event,
      gameMarkets: marketsByEvent.get(eventId) ?? [],
      props: propsByEvent.get(eventId) ?? [],
    })
  })
  return results
}

/**
 * Fetch all events + markets for a DK league.
 * Two-phase: 1) game-level via subcategory filter, 2) all markets for props.
 * If the all-markets call fails, game-level results still work.
 */
async function fetchLeague(
  league: typeof DK_LEAGUES[number],
): Promise<DKResult[]> {
  try {
    // Phase 1: Game-level markets (fast, reliable — subcategory-filtered)
    const gameUrl = buildGameUrl(league.leagueId, league.subcategoryId)
    const gameResp = await dkFetch(gameUrl)
    if (!gameResp.ok) {
      const body = await gameResp.text().catch(() => '')
      console.error(`DK league ${league.name}: HTTP ${gameResp.status} ${body.slice(0, 200)}`)
      return []
    }
    const gameData = await gameResp.json()
    const results = parseLeagueData(gameData, league)

    // Phase 2: Discover prop subcategory IDs from event metadata, then fetch props.
    // DK events have clientMetadata.Subcategories listing all available subcategories.
    // We skip the game lines subcategory and fetch each remaining one for props.
    const resultsByEventId = new Map<string, DKResult>()
    for (const r of results) resultsByEventId.set(r.event.eventId, r)

    // Discover all prop subcategory IDs from the first few events.
    // DK used to expose `clientMetadata.Subcategories` with an array of
    // {Id, Name} entries. Probe multiple known shapes because their payload
    // schema has drifted — sometimes it's Subcategories, subcategories,
    // SubCategories, or a flat array on the event root.
    const propSubcategoryIds = new Set<string>()
    const firstEvent = (gameData.events ?? []).find((e: any) => e.status === 'NOT_STARTED')
    for (const ev of gameData.events ?? []) {
      if (ev.status !== 'NOT_STARTED') continue
      const cm = ev.clientMetadata ?? {}
      const subs: any[] =
        cm.Subcategories ??
        cm.subcategories ??
        cm.SubCategories ??
        cm.subCategories ??
        ev.subcategories ??
        ev.Subcategories ??
        []
      for (const s of subs) {
        const id = String(s.Id ?? s.id ?? s.subcategoryId ?? s)
        if (id && id !== league.subcategoryId) {
          propSubcategoryIds.add(id)
        }
      }
      if (propSubcategoryIds.size > 0) break
    }

    if (propSubcategoryIds.size > 0) {
      console.log(`[DK] ${league.name}: discovered ${propSubcategoryIds.size} prop subcategories: ${[...propSubcategoryIds].join(', ')}`)
    } else if (league.name === 'NBA') {
      // Fire every run (no once-per-process guard) until DK props flow again.
      console.log('[DK NBA shape]', {
        responseRootKeys: Object.keys(gameData ?? {}),
        responseMetadataKeys: gameData?.metadata ? Object.keys(gameData.metadata) : null,
        responseMetadataSample: gameData?.metadata,
        responseSubcategoriesSample: gameData?.subcategories,
        firstEventMetadata: firstEvent?.metadata,
        firstEventTags: firstEvent?.tags,
        leagueData: gameData?.leagues?.[0] ?? gameData?.league,
      })
    }

    // Fetch props: for each event × each prop subcategory
    // Use the eventSubcategory endpoint discovered from DK DevTools
    const eventIds = results.map(r => r.event.eventId)
    const PROP_BATCH = 5

    for (const subId of propSubcategoryIds) {
      for (let i = 0; i < eventIds.length; i += PROP_BATCH) {
        const batch = eventIds.slice(i, i + PROP_BATCH)
        await Promise.all(
          batch.map(async (eventId) => {
            try {
              const url = buildEventPropUrl(eventId, subId)
              const resp = await dkFetch(url)
              if (!resp.ok) return

              const data = await resp.json()
              const markets = data.markets ?? []
              const selections = data.selections ?? []
              if (markets.length === 0) return

              const selByMarket = new Map<string, any[]>()
              for (const s of selections) {
                const list = selByMarket.get(s.marketId) ?? []
                list.push(s)
                selByMarket.set(s.marketId, list)
              }

              const result = resultsByEventId.get(eventId)
              if (!result) return

              for (const market of markets) {
                const typeName = (market.marketType?.name ?? '').toLowerCase()
                const propCategory = DK_PROP_MAP[typeName]
                if (!propCategory) continue

                const sels = selByMarket.get(market.id) ?? []
                if (sels.length !== 2) continue

                const overSel = sels.find((s: any) => s.outcomeType === 'Over')
                const underSel = sels.find((s: any) => s.outcomeType === 'Under')
                if (!overSel && !underSel) continue

                const playerRaw = (market.name ?? '').trim()
                if (!playerRaw) continue

                const lineValue = overSel?.points ?? underSel?.points ?? null
                if (lineValue == null) continue

                result.props.push({
                  propCategory,
                  playerName: normalizePlayerName(playerRaw),
                  lineValue,
                  overPrice: parseAmerican(overSel?.displayOdds?.american),
                  underPrice: parseAmerican(underSel?.displayOdds?.american),
                  yesPrice: null,
                  noPrice: null,
                  isBinary: false,
                })
              }
            } catch {
              // Per-event prop fetch failed — skip
            }
          })
        )
      }
    }

    // Dedup props per event (same player+category+line from different subcategories)
    for (const r of results) {
      const seen = new Set<string>()
      r.props = r.props.filter(p => {
        const key = `${p.playerName}|${p.propCategory}|${p.lineValue}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    const propCount = results.reduce((s, r) => s + r.props.length, 0)
    console.log(`[DK] ${league.name}: ${propCount} player props from ${results.length} events`)

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
