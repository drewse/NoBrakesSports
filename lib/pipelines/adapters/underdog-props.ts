/**
 * Underdog Fantasy (DFS pick-em) adapter.
 *
 * Unlike PrizePicks, Underdog quotes REAL American odds per side — every
 * over_under_line has options[] with american_price values (e.g. "-120" /
 * "-103"). Ingest as a normal priced prop source (Model B), not line-only.
 *
 * Endpoint:
 *   GET https://api.underdogfantasy.com/beta/v5/over_under_lines
 *   No auth, no query params. Returns one big payload (~16MB) containing
 *   over_under_lines[] + appearances[] + players[] + games[] for every
 *   active sport simultaneously. We filter to NBA/MLB/NHL/NFL/WNBA.
 *
 * Join chain per line:
 *   line.over_under.appearance_stat.appearance_id → appearance
 *   appearance.player_id → player (sport_id + name)
 *   appearance.match_id  → game (team names + start time)
 *   line.options[]       → higher/lower American prices
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const ENDPOINT = 'https://api.underdogfantasy.com/beta/v5/over_under_lines'

const SPORT_TO_LEAGUE: Record<string, { leagueSlug: string; sport: string }> = {
  NBA:  { leagueSlug: 'nba',  sport: 'basketball' },
  WNBA: { leagueSlug: 'wnba', sport: 'basketball' },
  MLB:  { leagueSlug: 'mlb',  sport: 'baseball'   },
  NHL:  { leagueSlug: 'nhl',  sport: 'ice_hockey' },
  NFL:  { leagueSlug: 'nfl',  sport: 'football'   },
}

// display_stat → canonical prop_category.
const STAT_TO_CATEGORY: Record<string, string> = {
  // NBA / WNBA
  'Points':            'player_points',
  'Rebounds':          'player_rebounds',
  'Assists':           'player_assists',
  '3-Pointers Made':   'player_threes',
  'Steals':            'player_steals',
  'Blocks':            'player_blocks',
  'Turnovers':         'player_turnovers',
  'Pts + Rebs + Asts': 'player_pts_reb_ast',
  'Pts + Asts':        'player_pts_ast',
  'Pts + Rebs':        'player_pts_reb',
  'Rebs + Asts':       'player_ast_reb',
  'Blks + Stls':       'player_blks_stls',
  // MLB
  'Hits':                'player_hits',
  'Total Bases':         'player_total_bases',
  'Runs':                'player_runs',
  'RBIs':                'player_rbis',
  'Stolen Bases':        'player_stolen_bases',
  'Walks':               'player_walks',
  'Home Runs':           'player_home_runs',
  'Strikeouts':          'player_strikeouts_p',
  'Hits Allowed':        'player_hits_allowed',
  'Earned Runs Allowed': 'player_earned_runs',
  'Pitching Outs':       'pitcher_outs',
  'Hits + Runs + RBIs':  'player_hits_runs_rbis',
  // NHL
  'Goals':             'player_goals',
  'Shots on Goal':     'player_shots_on_goal',
  'Saves':             'player_saves',
  'Goals Allowed':     'player_goals_allowed',
  'Power Play Points': 'player_power_play_pts',
  'Hockey Assists':    'player_hockey_assists',
  'Hockey Points':     'player_hockey_points',
}

export interface UDEvent {
  leagueSlug: string
  sport: string
  startTime: string
  homeTeam: string
  awayTeam: string
}

export interface UDResult {
  event: UDEvent
  props: NormalizedProp[]
  gameMarkets: []
}

interface UDAppearance { id: string; player_id: string; team_id?: string; match_id: number; type: string }
interface UDPlayer { id: string; first_name: string; last_name: string; sport_id: string }
interface UDGame {
  id: number
  full_team_names_title?: string
  home_team_id: string
  away_team_id: string
  scheduled_at: string
}
interface UDOption {
  american_price?: string
  choice: 'higher' | 'lower' | string
  status?: string
}
interface UDLine {
  id: string
  stat_value?: number | string | null
  status?: string
  options?: UDOption[]
  over_under?: {
    category?: string
    appearance_stat?: {
      appearance_id?: string
      display_stat?: string
    }
  }
}

interface UDResponse {
  appearances?: UDAppearance[]
  games?: UDGame[]
  players?: UDPlayer[]
  over_under_lines?: UDLine[]
  solo_games?: any[]
}

/** Parse "Orlando Magic @ Detroit Pistons" → { away: "Orlando Magic", home: "Detroit Pistons" }. */
function splitFullTeamsTitle(title: string): { home: string; away: string } | null {
  if (!title) return null
  const idx = title.indexOf(' @ ')
  if (idx < 0) return null
  const away = title.slice(0, idx).trim()
  const home = title.slice(idx + 3).trim()
  if (!away || !home) return null
  return { home, away }
}

function parseAmerican(s: string | undefined): number | null {
  if (!s) return null
  const n = parseInt(s.replace(/^\+/, ''), 10)
  return isNaN(n) ? null : n
}

export async function scrapeUnderdog(
  signal?: AbortSignal,
): Promise<UDResult[]> {
  let resp: Response
  try {
    resp = await pipeFetch(ENDPOINT, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal,
    })
  } catch (err: any) {
    console.warn(`[Underdog] fetch error`, { message: err?.message ?? String(err) })
    return []
  }
  if (!resp.ok) {
    console.warn(`[Underdog] non-ok`, { status: resp.status })
    return []
  }

  // Parse the ~16MB response, build lookup maps immediately, then drop
  // references to the raw arrays so V8 can GC them before we walk lines.
  // Otherwise parsed JSON + derived maps + line iteration all sit in
  // heap together and push us past Vercel's function memory budget.
  let body: UDResponse | null = await resp.json() as UDResponse
  const appById    = new Map((body.appearances ?? []).map(a => [a.id, a]))
  const playerById = new Map((body.players ?? []).map(p => [p.id, p]))
  const gameById   = new Map((body.games ?? []).map(g => [g.id, g]))
  const lines = body.over_under_lines ?? []
  body = null  // drop the root reference; raw JSON + solo_games can GC now

  // Group props by game id (match_id). Each game becomes one UDResult.
  const byGame = new Map<number, NormalizedProp[]>()
  const gameMeta = new Map<number, UDEvent>()

  let skippedSport = 0
  let skippedStat = 0
  let skippedShape = 0

  for (const line of lines) {
    if (line.status && line.status !== 'active') { skippedShape++; continue }
    if (line.over_under?.category !== 'player_prop') { skippedShape++; continue }

    const displayStat = line.over_under?.appearance_stat?.display_stat ?? ''
    const category = STAT_TO_CATEGORY[displayStat]
    if (!category) { skippedStat++; continue }

    const appearanceId = line.over_under?.appearance_stat?.appearance_id
    const appearance = appearanceId ? appById.get(appearanceId) : undefined
    if (!appearance) { skippedShape++; continue }

    const player = playerById.get(appearance.player_id)
    if (!player) { skippedShape++; continue }

    const leagueMap = SPORT_TO_LEAGUE[player.sport_id]
    if (!leagueMap) { skippedSport++; continue }

    const game = gameById.get(appearance.match_id)
    if (!game) { skippedShape++; continue }
    const teams = splitFullTeamsTitle(game.full_team_names_title ?? '')
    if (!teams) { skippedShape++; continue }

    const lineValue = typeof line.stat_value === 'number'
      ? line.stat_value
      : (line.stat_value ? Number(line.stat_value) : NaN)
    if (!isFinite(lineValue)) { skippedShape++; continue }

    // Extract prices from options[]. Underdog uses "higher"/"lower"; map
    // to our over/under semantics (higher = over).
    let overPrice: number | null = null
    let underPrice: number | null = null
    for (const opt of line.options ?? []) {
      if (opt.status && opt.status !== 'active') continue
      const px = parseAmerican(opt.american_price)
      if (px == null) continue
      if (opt.choice === 'higher') overPrice = px
      else if (opt.choice === 'lower') underPrice = px
    }
    if (overPrice == null && underPrice == null) { skippedShape++; continue }

    if (!gameMeta.has(game.id)) {
      gameMeta.set(game.id, {
        leagueSlug: leagueMap.leagueSlug,
        sport:      leagueMap.sport,
        startTime:  game.scheduled_at,
        homeTeam:   teams.home,
        awayTeam:   teams.away,
      })
    }

    const full = [player.first_name, player.last_name].filter(Boolean).join(' ').trim()
    const list = byGame.get(game.id) ?? []
    list.push({
      propCategory: category,
      playerName:   normalizePlayerName(full),
      lineValue,
      overPrice,
      underPrice,
      yesPrice:     null,
      noPrice:      null,
      isBinary:     false,
    })
    byGame.set(game.id, list)
  }

  const out: UDResult[] = []
  for (const [gid, props] of byGame) {
    const meta = gameMeta.get(gid)!
    out.push({ event: meta, props, gameMarkets: [] })
  }

  // Per-sport counts for visibility.
  const perSport = new Map<string, { games: number; props: number }>()
  for (const r of out) {
    const key = r.event.leagueSlug
    const cur = perSport.get(key) ?? { games: 0, props: 0 }
    cur.games += 1
    cur.props += r.props.length
    perSport.set(key, cur)
  }
  console.log(`[Underdog] total: ${out.length} games, ${out.reduce((s, r) => s + r.props.length, 0)} props; by league:`,
    Object.fromEntries(perSport))
  if (skippedSport || skippedStat) {
    console.log(`[Underdog] skipped: sport=${skippedSport} unmapped_stat=${skippedStat} shape=${skippedShape}`)
  }

  return out
}
