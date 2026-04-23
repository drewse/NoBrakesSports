/**
 * PrizePicks (DFS pick-em) adapter.
 *
 * Model A ingestion: PrizePicks is not a traditional sportsbook — picks pay
 * out 2×/5×/10×/25× based on how many legs win, with no separate over/under
 * pricing per leg. We ingest the LINES only (line_value populated,
 * over_price / under_price left NULL). Lets the UI surface PrizePicks-sharp
 * lines without fabricating synthetic per-leg odds.
 *
 * Endpoint:
 *   GET https://api.prizepicks.com/projections?league_id={id}
 *   No auth, no per_page honoured — returns all pre-game projections for
 *   the league as a JSON:API document with data[] + included[].
 *
 * Included types needed:
 *   new_player — player display_name, team abbreviation
 *   stat_type  — stat display name (e.g. "Points", "Pts+Rebs+Asts")
 *   game       — metadata.game_info.teams.{home,away}.abbreviation + start
 *   team       — abbreviation → market + name (for full-name lookup)
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://api.prizepicks.com/projections'

interface PPLeague {
  leagueId: string
  leagueSlug: string
  sport: string
}

const PP_LEAGUES: PPLeague[] = [
  { leagueId: '7', leagueSlug: 'nba', sport: 'basketball' },
  { leagueId: '2', leagueSlug: 'mlb', sport: 'baseball'   },
  { leagueId: '8', leagueSlug: 'nhl', sport: 'ice_hockey' },
  // NFL (id=9) is seasonal; off-season returns empty. Leaving it enabled
  // so it picks up automatically in fall without a code change.
  { leagueId: '9', leagueSlug: 'nfl', sport: 'football'   },
]

// stat_type.attributes.name → canonical prop_category.
// Only stats that map cleanly to categories we already have in the prop
// taxonomy. Exotic PP stats (Dunks, FG Made, "1st 3 Minutes", quarter
// milestones, double/triple doubles) are skipped — they don't cross-
// reference to sportsbook props.
const STAT_TO_CATEGORY: Record<string, string> = {
  // NBA core
  'Points':                   'player_points',
  'Rebounds':                 'player_rebounds',
  'Assists':                  'player_assists',
  'Steals':                   'player_steals',
  'Blocks':                   'player_blocks',
  'Turnovers':                'player_turnovers',
  '3-PT Made':                'player_threes',
  'Pts+Rebs+Asts':            'player_pts_reb_ast',
  'Pts+Asts':                 'player_pts_ast',
  'Pts+Rebs':                 'player_pts_reb',
  'Rebs+Asts':                'player_ast_reb',
  'Blks+Stls':                'player_blks_stls',
  // MLB core
  'Hits':                     'player_hits',
  'Total Bases':              'player_total_bases',
  'Runs':                     'player_runs',
  'RBIs':                     'player_rbis',
  'Stolen Bases':             'player_stolen_bases',
  'Walks':                    'player_walks',
  'Home Runs':                'player_home_runs',
  'Strikeouts':               'player_strikeouts_p',
  'Hits Allowed':             'player_hits_allowed',
  'Earned Runs Allowed':      'player_earned_runs',
  'Pitching Outs':            'pitcher_outs',
  'Hits+Runs+RBIs':           'player_hits_runs_rbis',
  // NHL core
  'Shots On Goal':            'player_shots_on_goal',
  'Goalie Saves':             'player_saves',
  'Goals':                    'player_goals',
  'Hockey Assists':           'player_hockey_assists',
  'Hockey Points':            'player_hockey_points',
  'Power Play Points':        'player_power_play_pts',
}

export interface PPEvent {
  leagueSlug: string
  sport: string
  startTime: string    // ISO
  homeTeam: string     // full "Houston Rockets"
  awayTeam: string
}

export interface PrizePicksResult {
  event: PPEvent
  props: NormalizedProp[]
  gameMarkets: []      // DFS — no game-level markets; empty for shape-parity
}

interface Resource { id: string; type: string; attributes: any; relationships?: any }

async function fetchLeague(
  league: PPLeague,
  signal?: AbortSignal,
): Promise<PrizePicksResult[]> {
  const url = `${BASE}?league_id=${league.leagueId}`
  let resp: Response
  try {
    resp = await pipeFetch(url, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal,
    })
  } catch (err: any) {
    console.warn(`[PrizePicks] fetch error`, { league: league.leagueSlug, message: err?.message ?? String(err) })
    return []
  }
  if (!resp.ok) {
    console.warn(`[PrizePicks] listView non-ok`, { league: league.leagueSlug, status: resp.status })
    return []
  }

  const body = await resp.json() as { data: Resource[]; included?: Resource[] }
  const data = Array.isArray(body?.data) ? body.data : []
  const included = Array.isArray(body?.included) ? body.included : []

  // Build include lookup maps.
  const players = new Map<string, { displayName: string; teamAbbr: string }>()
  const statTypes = new Map<string, string>()      // id → stat name
  const teams = new Map<string, { market: string; name: string }>()  // abbr → fullName parts
  const games = new Map<string, { home: string; away: string; start: string }>()  // id → abbrs
  for (const inc of included) {
    if (inc.type === 'new_player') {
      players.set(inc.id, {
        displayName: inc.attributes?.display_name ?? inc.attributes?.name ?? '',
        teamAbbr:    inc.attributes?.team ?? '',
      })
    } else if (inc.type === 'stat_type') {
      statTypes.set(inc.id, String(inc.attributes?.name ?? ''))
    } else if (inc.type === 'team') {
      const abbr = inc.attributes?.abbreviation
      if (abbr) {
        teams.set(String(abbr), {
          market: String(inc.attributes?.market ?? ''),
          name:   String(inc.attributes?.name ?? ''),
        })
      }
    } else if (inc.type === 'game') {
      const tb = inc.attributes?.metadata?.game_info?.teams
      const home = tb?.home?.abbreviation
      const away = tb?.away?.abbreviation
      const start = inc.attributes?.start_time
      if (home && away && start) {
        games.set(inc.id, { home: String(home), away: String(away), start: String(start) })
      }
    }
  }

  const fullName = (abbr: string): string => {
    const t = teams.get(abbr)
    if (!t) return abbr
    const m = t.market.trim()
    const n = t.name.trim()
    return [m, n].filter(Boolean).join(' ').trim() || abbr
  }

  // Group projections by game id. We skip any projection whose game can't
  // be resolved (live/untracked) since findEvent needs home+away.
  const byGame = new Map<string, NormalizedProp[]>()
  const gameMeta = new Map<string, { home: string; away: string; start: string }>()

  for (const proj of data) {
    if (proj.type !== 'projection') continue
    const a = proj.attributes ?? {}
    if (a.status !== 'pre_game') continue
    // Skip demon/goblin (alt lines) — they're pricing variants we'd be
    // double-counting. Standard lines only.
    if (a.odds_type && a.odds_type !== 'standard') continue

    const statTypeId = proj.relationships?.stat_type?.data?.id
    const statName = statTypeId ? statTypes.get(statTypeId) ?? '' : ''
    const category = STAT_TO_CATEGORY[statName]
    if (!category) continue  // unmapped exotic stat

    const playerId = proj.relationships?.new_player?.data?.id
    const player = playerId ? players.get(playerId) : undefined
    if (!player?.displayName) continue

    const gameId = proj.relationships?.game?.data?.id
    const game = gameId ? games.get(gameId) : undefined
    if (!game) continue

    const line = typeof a.line_score === 'number' ? a.line_score : Number(a.line_score)
    if (!isFinite(line)) continue

    // Register game metadata once.
    if (!gameMeta.has(gameId!)) {
      gameMeta.set(gameId!, {
        home:  fullName(game.home),
        away:  fullName(game.away),
        start: game.start,
      })
    }

    const list = byGame.get(gameId!) ?? []
    list.push({
      propCategory: category,
      playerName:   normalizePlayerName(player.displayName),
      lineValue:    line,
      // Model A: line-only. No per-leg prices for pick-em.
      overPrice:    null,
      underPrice:   null,
      yesPrice:     null,
      noPrice:      null,
      isBinary:     false,
    })
    byGame.set(gameId!, list)
  }

  const out: PrizePicksResult[] = []
  for (const [gid, props] of byGame) {
    const meta = gameMeta.get(gid)!
    out.push({
      event: {
        leagueSlug: league.leagueSlug,
        sport:      league.sport,
        startTime:  meta.start,
        homeTeam:   meta.home,
        awayTeam:   meta.away,
      },
      props,
      gameMarkets: [],
    })
  }
  return out
}

export async function scrapePrizePicks(
  signal?: AbortSignal,
): Promise<PrizePicksResult[]> {
  // Serial per-league to cap peak memory at ~7MB (one response) instead of
  // ~28MB (4 parallel responses). Vercel's sync-props function was OOM'ing
  // on the parallel path once Underdog was added alongside.
  const out: PrizePicksResult[] = []
  for (const lg of PP_LEAGUES) {
    if (signal?.aborted) break
    const res = await fetchLeague(lg, signal)
    console.log(`[PrizePicks:${lg.leagueSlug}] ${res.length} games, ${res.reduce((s, r) => s + r.props.length, 0)} props`)
    for (const r of res) out.push(r)
  }
  return out
}
