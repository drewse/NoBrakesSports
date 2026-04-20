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
const DK_HOST = 'https://sportsbook-nash.draftkings.com'
// Public DK sportsbook host — this is the domain the web UI hits for
// /api/v5/ endpoints (publicly documented by community scrapers). The
// Nashville CDN geofences /api/v5/ but the main host serves it.
const DK_PUBLIC_HOST = 'https://sportsbook.draftkings.com'

// DraftKings league IDs + game lines subcategory per sport.
// Each sport uses a different subcategory ID for game lines (ML/spread/total).
// `propSubcategoryIds` lists known per-stat prop subcategories since DK
// removed clientMetadata.Subcategories from the API response in late 2025.
// These are stable DK ids discovered via DevTools on the live site.
export const DK_LEAGUES: {
  sport: string
  leagueId: string
  leagueSlug: string
  name: string
  subcategoryId: string
  propSubcategoryIds: string[]
}[] = [
  {
    sport: 'basketball', leagueId: '42648', leagueSlug: 'nba', name: 'NBA', subcategoryId: '4511',
    // Live DK NBA prop milestone subcategory IDs. Dropped 16463/16464/
    // 16471-16475 ("race to X", "most X") — those aren't per-player O/U
    // props and don't map to a prop_category.
    propSubcategoryIds: [
      '16477', // points milestones
      '16478', // assists milestones
      '16479', // rebounds milestones
      '16480', // three pointers made milestones
      '16481', // points + assists milestones
      '16482', // points + rebounds milestones
      '16483', // points + rebounds + assists milestones
      '16484', // blocks milestones
      '16485', // steals milestones
    ],
  },
  {
    sport: 'baseball', leagueId: '84240', leagueSlug: 'mlb', name: 'MLB', subcategoryId: '4519',
    // Live DK MLB subcategory IDs captured by the phase-1 probe. Listed
    // explicitly instead of a wide scan so we don't burn thousands of
    // requests per cron cycle (which was timing out and triggering DK
    // connection resets on other leagues).
    propSubcategoryIds: [
      '15219', '15221', '15418',
      '15628', '15629', '15630', '15631', '15632',
      '15891', '15892', '15893', '15972',
      '16216', '16217', '16218', '16220', '16221', '16222', '16223',
      '16261', '16262', '16263', '16264', '16265', '16266', '16268',
    ],
  },
  {
    sport: 'ice_hockey', leagueId: '42133', leagueSlug: 'nhl', name: 'NHL', subcategoryId: '4515',
    // Shots on Goal, Goals, Points, Assists, Saves, Power Play Points
    propSubcategoryIds: ['15112', '15113', '15114', '15115', '15116', '15117'],
  },
  {
    sport: 'soccer', leagueId: '40253', leagueSlug: 'epl', name: 'EPL', subcategoryId: '4516',
    propSubcategoryIds: [],
  },
  {
    sport: 'soccer', leagueId: '59974', leagueSlug: 'laliga', name: 'La Liga', subcategoryId: '4516',
    propSubcategoryIds: [],
  },
  {
    sport: 'soccer', leagueId: '59979', leagueSlug: 'bundesliga', name: 'Bundesliga', subcategoryId: '4516',
    propSubcategoryIds: [],
  },
  {
    sport: 'soccer', leagueId: '59977', leagueSlug: 'seria_a', name: 'Serie A', subcategoryId: '4516',
    propSubcategoryIds: [],
  },
  {
    sport: 'soccer', leagueId: '59976', leagueSlug: 'ligue_one', name: 'Ligue 1', subcategoryId: '4516',
    propSubcategoryIds: [],
  },
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
  // Basketball — main O/U
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
  // Basketball — DK's current "milestones" threshold markets
  'points milestones': 'player_points',
  'rebounds milestones': 'player_rebounds',
  'assists milestones': 'player_assists',
  'three pointers made milestones': 'player_threes',
  'threes milestones': 'player_threes',
  'blocks milestones': 'player_blocks',
  'steals milestones': 'player_steals',
  'points + rebounds + assists milestones': 'player_pts_reb_ast',
  'points + rebounds milestones': 'player_pts_reb',
  'points + assists milestones': 'player_pts_ast',
  'rebounds + assists milestones': 'player_ast_reb',
  // MLB milestones (same threshold pattern)
  'hits milestones': 'player_hits',
  'total bases milestones': 'player_total_bases',
  'home runs milestones': 'player_home_runs',
  'rbis milestones': 'player_rbis',
  'runs milestones': 'player_runs',
  'strikeouts milestones': 'player_strikeouts_p',
  'pitcher strikeouts milestones': 'player_strikeouts_p',
  'walks milestones': 'player_walks',
  'stolen bases milestones': 'player_stolen_bases',
  'earned runs milestones': 'player_earned_runs',
  'outs milestones': 'pitcher_outs',
  'outs recorded milestones': 'pitcher_outs',
  'hits allowed milestones': 'player_hits_allowed',
  // NHL milestones
  'goals milestones': 'player_goals',
  'points milestones (nhl)': 'player_hockey_points',
  'shots on goal milestones': 'player_shots_on_goal',
  'saves milestones': 'player_saves',
  'power play points milestones': 'player_power_play_pts',
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

/** Probe URLs to discover which subcategory IDs DK uses today. The public
 *  sportsbook host serves /api/v5/eventgroups/* — the community-documented
 *  endpoint most DK scrapers use. We try multiple site codes because the
 *  endpoint 404s/403s unless the site code matches where the leagueId lives. */
function buildDiscoveryUrls(leagueId: string, _eventId: string): string[] {
  const siteCodes = ['US-SB', 'US-NJ-SB', 'CA-ON-SB']
  const urls: string[] = []
  for (const site of siteCodes) {
    urls.push(`${DK_PUBLIC_HOST}/sites/${site}/api/v5/eventgroups/${leagueId}?format=json`)
    urls.push(`${DK_PUBLIC_HOST}/sites/${site}/api/v5/eventgroups/${leagueId}/full?format=json`)
  }
  // Flat paths some DK regions expose
  urls.push(`${DK_PUBLIC_HOST}/api/v5/eventgroups/${leagueId}?format=json`)
  urls.push(`${DK_PUBLIC_HOST}/api/v5/eventgroups/${leagueId}/full?format=json`)
  return urls
}


/** Browser-like headers matching what DK's web UI sends for /controldata/
 *  and /api/v5/ endpoints. Confirmed via a live curl capture on an Ontario
 *  DK event-subcategory request. */
const DK_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://sportsbook.draftkings.com',
  'Referer': 'https://sportsbook.draftkings.com/',
  'x-client-feature': 'eventSubcategory',
  'x-client-name': 'web',
  'x-client-page': 'event',
  'x-client-version': '2616.4.1.4',
  'x-client-widget-name': 'cms',
  'x-client-widget-version': '2.10.9',
}

/** Helper: fetch a DK URL with browser-like headers (required by the web
 *  UI's backend) + proxy fallback. */
async function dkFetch(url: string, _opts: { withBrowserHeaders?: boolean } = {}): Promise<Response> {
  const init: RequestInit = {
    signal: AbortSignal.timeout(12000),
    headers: DK_BROWSER_HEADERS,
  }
  try {
    const resp = await fetch(url, init)
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

    // Candidate prop subcategory IDs to scan. /api/v5/ is 403-blocked on
    // Vercel so we can't discover live IDs dynamically — but the scan
    // against the hardcoded range (seeded from a captured live curl) works.
    const propSubcategoryIds = new Set<string>(league.propSubcategoryIds)

    // Two-phase fetch to avoid Vercel timeout:
    //   Phase 1 — probe all candidate subcategory IDs ONLY against the
    //             first event. 40-50 concurrent probes finish in ~2s.
    //             Keep only the IDs that returned ≥1 market.
    //   Phase 2 — fetch the surviving IDs × every event in parallel.
    const eventIds = results.map(r => r.event.eventId)

    // Phase-1 probe skipped — the propSubcategoryIds lists in DK_LEAGUES
    // are already pre-trimmed to known-live IDs. Saves ~1.4k probe
    // requests per cron cycle.

    // Phase 2: fetch live IDs × all events. PROP_BATCH=5 caps concurrency.
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

                // ── Milestones branch ──
                // DK's current NBA prop shape: one market per (player, stat)
                // with N selections (one per threshold level). Each selection
                // has label "15+" / "18+" / ... and milestoneValue numeric.
                // Convert each selection to an over-only row at line=N-0.5.
                if (typeName.endsWith(' milestones')) {
                  // Extract player name: marketType "Points Milestones" →
                  // stat suffix "Points"; market.name "Donovan Mitchell
                  // Points" → player "Donovan Mitchell".
                  const statSuffix = (market.marketType?.name ?? '').replace(/\s+Milestones$/i, '').trim()
                  const rawName = (market.name ?? '').trim()
                  const playerRaw = statSuffix && rawName.toLowerCase().endsWith(statSuffix.toLowerCase())
                    ? rawName.slice(0, rawName.length - statSuffix.length).trim()
                    : rawName
                  if (!playerRaw) continue

                  for (const sel of sels) {
                    const threshold = typeof sel.milestoneValue === 'number'
                      ? sel.milestoneValue
                      : parseFloat(String(sel.milestoneValue ?? sel.label ?? '').replace(/[^\d.]/g, ''))
                    if (!isFinite(threshold)) continue
                    const price = parseAmerican(sel.displayOdds?.american)
                    if (price == null) continue
                    result.props.push({
                      propCategory,
                      playerName: normalizePlayerName(playerRaw),
                      lineValue: threshold - 0.5,
                      overPrice: price,
                      underPrice: null,
                      yesPrice: null,
                      noPrice: null,
                      isBinary: false,
                    })
                  }
                  continue
                }

                // ── Classic O/U branch ──
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
    if (results.length > 0) {
      console.log(`[DK] ${league.name}: ${propCount} player props from ${results.length} events`)
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
