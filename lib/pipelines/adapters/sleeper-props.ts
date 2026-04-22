/**
 * Sleeper Picks (DFS pick-em) adapter.
 *
 * API shape:
 *   GET https://api.sleeper.com/lines/available
 *     → array of ~2500 lines, mixed across NBA/MLB/NHL/WNBA/tennis/mma/soccer.
 *   GET https://api.sleeper.com/players/{sport}
 *     → object keyed by player_id with first_name, last_name, team abbr.
 *
 * Per-line fields we use:
 *   sport          — "nba" | "mlb" | "nhl" | "wnba"
 *   subject_id     — player ID (opaque string, joined to /players/{sport})
 *   subject_team   — abbreviation ("DET") of the player's team
 *   wager_type     — stat name ("assists", "rebounds", "strikeouts_pitched")
 *   game_id        — opaque game identifier; home/away derived from the
 *                    set of subject_team values appearing in lines for this
 *                    game_id (always exactly two teams per game)
 *   status         — must be "active"
 *   game_status    — must be "pre_game"
 *   options[]      — { outcome: "over"|"under", outcome_value: 2.5,
 *                      payout_multiplier: "1.84" }  (decimal odds)
 *
 * No game start_time is exposed, so the sync-sleeper cron matches events
 * by (league, {home, away}) within an upcoming-events window rather than
 * the exact canonical-key tuple sync-props uses.
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const LINES_URL = 'https://api.sleeper.com/lines/available'
const PLAYERS_URL = (sport: string) => `https://api.sleeper.com/players/${sport}`

// Sleeper sport → our league slug + canonical sport.
const SPORT_TO_LEAGUE: Record<string, { leagueSlug: string; sport: string }> = {
  nba:  { leagueSlug: 'nba',  sport: 'basketball' },
  wnba: { leagueSlug: 'wnba', sport: 'basketball' },
  mlb:  { leagueSlug: 'mlb',  sport: 'baseball'   },
  nhl:  { leagueSlug: 'nhl',  sport: 'ice_hockey' },
  // NFL has its own slug; Sleeper uses "nfl" directly
  nfl:  { leagueSlug: 'nfl',  sport: 'football'   },
}

// wager_type → canonical prop_category. Sleeper uses snake_case names
// that don't always line up with PrizePicks/Underdog display_stat labels.
const STAT_TO_CATEGORY: Record<string, string> = {
  // NBA / WNBA
  'points':                 'player_points',
  'rebounds':               'player_rebounds',
  'assists':                'player_assists',
  'steals':                 'player_steals',
  'blocks':                 'player_blocks',
  'turnovers':              'player_turnovers',
  'three_pointers_made':    'player_threes',
  '3pt_made':               'player_threes',
  'points_rebounds_assists':'player_pts_reb_ast',
  'points_assists':         'player_pts_ast',
  'points_rebounds':        'player_pts_reb',
  'rebounds_assists':       'player_ast_reb',
  'blocks_steals':          'player_blks_stls',
  // MLB
  'hits':                   'player_hits',
  'total_bases':            'player_total_bases',
  'runs':                   'player_runs',
  'rbis':                   'player_rbis',
  'stolen_bases':           'player_stolen_bases',
  'walks':                  'player_walks',
  'home_runs':              'player_home_runs',
  'strikeouts_pitched':     'player_strikeouts_p',
  'hits_allowed':           'player_hits_allowed',
  'earned_runs_allowed':    'player_earned_runs',
  'pitching_outs':          'pitcher_outs',
  'hits_runs_rbis':         'player_hits_runs_rbis',
  // NHL
  'goals':                  'player_goals',
  'shots_on_goal':          'player_shots_on_goal',
  'saves':                  'player_saves',
  'goals_allowed':          'player_goals_allowed',
  'power_play_points':      'player_power_play_pts',
  'hockey_assists':         'player_hockey_assists',
  'hockey_points':          'player_hockey_points',
}

export interface SLEvent {
  leagueSlug: string
  sport: string
  homeTeamAbbr: string  // "DET"
  awayTeamAbbr: string
  gameId: string        // opaque — used only for grouping, not matching
}

export interface SLResult {
  event: SLEvent
  props: NormalizedProp[]
  gameMarkets: []
}

interface SLOption {
  outcome: 'over' | 'under' | string
  outcome_value?: number | string | null
  payout_multiplier?: string
  status?: string
}
interface SLLine {
  status?: string
  sport?: string
  subject_id?: string
  subject_team?: string
  wager_type?: string
  outcome_type?: string
  game_id?: string
  game_status?: string
  options?: SLOption[]
}

interface SLPlayer { first_name?: string; last_name?: string; team?: string }

/** Convert a decimal payout multiplier (e.g. "1.84") to American odds. */
function decimalToAmerican(s: string | undefined): number | null {
  if (!s) return null
  const d = parseFloat(s)
  if (!isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const resp = await pipeFetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal,
    })
    if (!resp.ok) {
      console.warn(`[Sleeper] non-ok`, { url: url.slice(0, 80), status: resp.status })
      return null
    }
    return await resp.json() as T
  } catch (err: any) {
    console.warn(`[Sleeper] fetch error`, { url: url.slice(0, 80), message: err?.message ?? String(err) })
    return null
  }
}

export async function scrapeSleeper(
  signal?: AbortSignal,
): Promise<SLResult[]> {
  // 1) Fetch the lines list.
  const lines = await fetchJson<SLLine[]>(LINES_URL, signal)
  if (!lines || !Array.isArray(lines) || lines.length === 0) return []

  // 2) Discover which sports we need player indexes for. Only pull the
  //    indexes for sports present in our SPORT_TO_LEAGUE map — skip
  //    tennis/mma/soccer even though Sleeper returns them.
  const sportsNeeded = new Set<string>()
  for (const l of lines) {
    if (l.sport && SPORT_TO_LEAGUE[l.sport]) sportsNeeded.add(l.sport)
  }
  if (sportsNeeded.size === 0) return []

  const playersBySport: Record<string, Record<string, SLPlayer>> = {}
  for (const sp of sportsNeeded) {
    if (signal?.aborted) return []
    const idx = await fetchJson<Record<string, SLPlayer>>(PLAYERS_URL(sp), signal)
    if (idx) playersBySport[sp] = idx
  }

  // 3) Group lines by (sport, game_id). Each game has two subject_team
  //    abbreviations — we'll resolve home/away in the cron using the DB
  //    teams table, since Sleeper's API doesn't expose home/away flags.
  type GameKey = string   // `${sport}|${gameId}`
  const gameTeams = new Map<GameKey, Set<string>>()
  const gameProps = new Map<GameKey, NormalizedProp[]>()
  const gameMeta = new Map<GameKey, { sport: string; gameId: string }>()

  let skippedSport = 0
  let skippedStat = 0
  let skippedShape = 0

  for (const l of lines) {
    if (!l.sport) { skippedShape++; continue }
    const leagueMap = SPORT_TO_LEAGUE[l.sport]
    if (!leagueMap) { skippedSport++; continue }
    if (l.status !== 'active') { skippedShape++; continue }
    if (l.game_status && l.game_status !== 'pre_game') { skippedShape++; continue }
    if (l.outcome_type && l.outcome_type !== 'over_under') { skippedShape++; continue }

    const category = l.wager_type ? STAT_TO_CATEGORY[l.wager_type] : undefined
    if (!category) { skippedStat++; continue }

    const player = l.subject_id ? playersBySport[l.sport]?.[l.subject_id] : undefined
    if (!player?.first_name && !player?.last_name) { skippedShape++; continue }
    const fullName = [player.first_name, player.last_name].filter(Boolean).join(' ').trim()
    if (!fullName) { skippedShape++; continue }

    const gameId = l.game_id
    const teamAbbr = l.subject_team
    if (!gameId || !teamAbbr) { skippedShape++; continue }

    // Extract over/under prices + line from options[].
    let overPrice: number | null = null
    let underPrice: number | null = null
    let lineValue: number | null = null
    for (const opt of l.options ?? []) {
      if (opt.status && opt.status !== 'active') continue
      const px = decimalToAmerican(opt.payout_multiplier)
      if (px == null) continue
      if (lineValue == null && opt.outcome_value != null) {
        const v = typeof opt.outcome_value === 'number' ? opt.outcome_value : Number(opt.outcome_value)
        if (isFinite(v)) lineValue = v
      }
      if (opt.outcome === 'over') overPrice = px
      else if (opt.outcome === 'under') underPrice = px
    }
    if (lineValue == null) { skippedShape++; continue }
    if (overPrice == null && underPrice == null) { skippedShape++; continue }

    const key: GameKey = `${l.sport}|${gameId}`
    const teams = gameTeams.get(key) ?? new Set<string>()
    teams.add(teamAbbr)
    gameTeams.set(key, teams)
    if (!gameMeta.has(key)) gameMeta.set(key, { sport: l.sport, gameId })

    const props = gameProps.get(key) ?? []
    props.push({
      propCategory: category,
      playerName: normalizePlayerName(fullName),
      lineValue,
      overPrice,
      underPrice,
      yesPrice: null,
      noPrice: null,
      isBinary: false,
    })
    gameProps.set(key, props)
  }

  // 4) Produce SLResult per game. Skip any game_id that didn't collect
  //    exactly two distinct team abbrs — we can't determine home vs away
  //    for those, and they'll fail downstream event matching anyway.
  const out: SLResult[] = []
  for (const [key, teams] of gameTeams) {
    if (teams.size !== 2) { skippedShape++; continue }
    const meta = gameMeta.get(key)!
    const leagueMap = SPORT_TO_LEAGUE[meta.sport]!
    const [a, b] = [...teams]
    // Sleeper doesn't tell us which is home vs away. The cron will try
    // both orderings when matching against canonical events.
    out.push({
      event: {
        leagueSlug: leagueMap.leagueSlug,
        sport: leagueMap.sport,
        homeTeamAbbr: a,
        awayTeamAbbr: b,
        gameId: meta.gameId,
      },
      props: gameProps.get(key) ?? [],
      gameMarkets: [],
    })
  }

  const perLeague = new Map<string, { games: number; props: number }>()
  for (const r of out) {
    const cur = perLeague.get(r.event.leagueSlug) ?? { games: 0, props: 0 }
    cur.games += 1
    cur.props += r.props.length
    perLeague.set(r.event.leagueSlug, cur)
  }
  console.log(`[Sleeper] total: ${out.length} games, ${out.reduce((s, r) => s + r.props.length, 0)} props; by league:`,
    Object.fromEntries(perLeague))
  if (skippedSport || skippedStat || skippedShape) {
    console.log(`[Sleeper] skipped: sport=${skippedSport} unmapped_stat=${skippedStat} shape=${skippedShape}`)
  }

  return out
}
