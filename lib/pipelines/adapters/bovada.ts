/**
 * Bovada (offshore, Curaçao-licensed) adapter.
 *
 * Two-step API:
 *   1. League listing (default filter): only "Game Lines" displayGroup.
 *      Used to enumerate event IDs + URL slugs.
 *      GET /services/sports/event/coupon/events/A/description/{sport}/{league}
 *          ?preMatchOnly=true&marketFilterId=def
 *   2. Per-event detail (no filter): all 13 displayGroups including
 *      Player Points, Player Rebounds, Assists & Threes, Blocks & Steals,
 *      Player Combos. URL is BASE + event.link.
 *      GET BASE + event.link
 *
 * Response shape:
 *   [{ path:[...], events:[{
 *       id, description: "Away @ Home", startTime: <epoch ms>, link: "/...",
 *       competitors: [{ name, home: bool }, ...],
 *       displayGroups: [{ description, markets: [{
 *         description, period: { description },
 *         outcomes: [{ description, price: { american, handicap } }]
 *       }] }]
 *   }] }]
 *
 * We only take markets whose period.description === "Game" to filter out
 * 1st half / quarter / inning period markets.
 */

// Bovada serves /services/sports/event/coupon/events publicly to any
// IP class — direct fetch from Vercel returns 200 JSON with the full
// per-game payload. pipeFetch (PacketStream CA) is unnecessary here
// and a stale PROXY_URL silently failed every cycle, leaving 0 Bovada
// rows in the DB.

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'

const BASE = 'https://www.bovada.lv/services/sports/event/coupon/events/A/description'

// Canonical league slugs (`leagueSlug`) match rows in the `leagues` table
// — the sync-bovada cron pairs Bovada events to canonical events by
// `(league_slug, sorted-team-pair, ET-day-bucket)`. Adding a league here
// only surfaces data once another pipeline has populated canonical events
// for that league; otherwise rows show up under `unmatched` (harmless).
const LEAGUES: Array<{ path: string; leagueSlug: string; sport: string }> = [
  { path: 'basketball/nba',                            leagueSlug: 'nba',   sport: 'basketball' },
  { path: 'baseball/mlb',                              leagueSlug: 'mlb',   sport: 'baseball' },
  { path: 'hockey/nhl',                                leagueSlug: 'nhl',   sport: 'ice_hockey' },
  // ── Coverage upgrade (verified 2026-04-28) ───────────────────────
  { path: 'football/nfl',                              leagueSlug: 'nfl',   sport: 'football' },
  { path: 'football/college-football',                 leagueSlug: 'ncaaf', sport: 'football' },
  { path: 'basketball/college-basketball',             leagueSlug: 'ncaab', sport: 'basketball' },
  { path: 'soccer/europe/england/premier-league',      leagueSlug: 'epl',   sport: 'soccer' },
  { path: 'soccer/international-club/uefa-champions-league', leagueSlug: 'ucl', sport: 'soccer' },
  { path: 'soccer/north-america/united-states/mls',    leagueSlug: 'mls',   sport: 'soccer' },
]

export interface BovadaEvent {
  leagueSlug: string
  sport: string
  externalId: string
  startTime: string       // ISO
  homeTeam: string
  awayTeam: string
}

export interface BovadaGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface BovadaResult {
  event: BovadaEvent
  gameMarkets: BovadaGameMarket[]
  props: NormalizedProp[]
}

interface BvOutcome { description?: string; price?: { american?: string | number; decimal?: string | number; handicap?: string | number } }
interface BvMarket {
  description?: string
  period?: { description?: string }
  outcomes?: BvOutcome[]
}
interface BvCompetitor { name?: string; home?: boolean }
interface BvEvent {
  id: string | number
  description?: string
  startTime?: number
  link?: string
  competitors?: BvCompetitor[]
  displayGroups?: Array<{ description?: string; markets?: BvMarket[] }>
}

// Bovada market.description shapes for player props (basketball/MLB/NHL)
//   "Total Points - Joel Embiid (PHI)"
//   "Total Rebounds - Joel Embiid (PHI)"
//   "Total Assists - Joel Embiid (PHI)"
//   "Total 3-Pointers Made - Joel Embiid (PHI)"
//   "Total Blocks - Joel Embiid (PHI)"
//   "Total Steals - Joel Embiid (PHI)"
//   "Total Points + Rebounds + Assists - Joel Embiid (PHI)"
//   "Total Strikeouts - Yu Darvish (CHC)"
//   "Total Outs Recorded - Davis Martin (CWS)"
//   "Total Hits Allowed - Yu Darvish (CHC)"
//   "Total Bases - Aaron Judge (NYY)"
//   "Total Hits - Aaron Judge (NYY)"
//   "Shots on Goal - Connor McDavid (EDM)"
function classifyPropMarket(desc: string): string | null {
  const lower = desc.toLowerCase()
  // Reject period-scoped player props (1H/Q1/etc.) — those collapse onto
  // full-game arbs at the wrong line and would surface phantom edge.
  if (/(1st|2nd|3rd|4th)\s+(half|quarter|period|inning)|halftime/.test(lower)) return null
  // Combos first (substring collisions on "points" / "rebounds" / "assists")
  const hasPts = /\bpoints?\b/.test(lower)
  const hasReb = /\brebounds?\b/.test(lower)
  const hasAst = /\bassists?\b/.test(lower)
  if (hasPts && hasReb && hasAst) return 'player_pts_reb_ast'
  if (hasPts && hasReb) return 'player_pts_reb'
  if (hasPts && hasAst) return 'player_pts_ast'
  if (hasReb && hasAst) return 'player_ast_reb'
  if (/\bsteals?\b/.test(lower) && /\bblocks?\b/.test(lower)) return 'player_steals_blocks'
  // 3-pointers
  if (/3-?pointers?\s+made|three\s+pointers?\s+made|threes\s+made|3-?pointers?(?!\s+attempted)/.test(lower)) return 'player_threes'
  // Singles (NBA)
  if (hasPts) return 'player_points'
  if (hasReb) return 'player_rebounds'
  if (hasAst) return 'player_assists'
  if (/\bblocks?\b/.test(lower)) return 'player_blocks'
  if (/\bsteals?\b/.test(lower)) return 'player_steals'
  if (/\bturnovers?\b/.test(lower)) return 'player_turnovers'
  // MLB
  if (/total\s+bases/.test(lower)) return 'player_total_bases'
  if (/strikeouts?(?!\s+against)/.test(lower)) return 'player_strikeouts_p'
  if (/outs\s+recorded|total\s+outs/.test(lower)) return 'pitcher_outs'
  if (/earned\s+runs/.test(lower)) return 'player_earned_runs'
  if (/home\s+runs?/.test(lower)) return 'player_home_runs'
  if (/hits\s+allowed/.test(lower)) return 'player_hits_allowed'
  if (/total\s+hits|player\s+hits|\bhits\b/.test(lower)) return 'player_hits'
  if (/\brbis?\b/.test(lower)) return 'player_rbis'
  if (/\bruns\b(?!\s+batted)/.test(lower)) return 'player_runs'
  if (/stolen\s+bases?/.test(lower)) return 'player_stolen_bases'
  // NHL
  if (/shots?\s+on\s+goal/.test(lower)) return 'player_shots_on_goal'
  if (/\bsaves\b/.test(lower)) return 'player_saves'
  if (/\bgoals\b/.test(lower)) return 'player_goals'
  return null
}

// Pull player name out of "<Stat Description> - <Player> (<TEAM>)"
function extractPropPlayer(desc: string): string | null {
  const lastDash = desc.lastIndexOf(' - ')
  if (lastDash === -1) return null
  const after = desc.slice(lastDash + 3).trim()
  const name = after.replace(/\s*\([A-Z0-9]{2,5}\)\s*$/, '').trim()
  return name.length > 2 ? name : null
}

function parseAmerican(v: string | number | undefined): number | null {
  if (v == null) return null
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null
  const n = parseInt(String(v).replace(/^\+/, ''), 10)
  return isNaN(n) ? null : n
}

function parseNumber(v: string | number | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(n) ? n : null
}

/** Map Bovada's market.description + period.description to our canonical types. */
function classifyGameMarket(m: BvMarket): 'moneyline' | 'spread' | 'total' | null {
  if (m.period?.description && m.period.description !== 'Game') return null
  const d = (m.description ?? '').toLowerCase()
  if (d === 'moneyline' || d === 'money line' || d === 'match winner') return 'moneyline'
  if (d === 'point spread' || d === 'run line' || d === 'puck line' || d === 'spread') return 'spread'
  if (d === 'total' || d === 'total points' || d === 'total runs' || d === 'total goals') return 'total'
  return null
}

async function fetchLeague(
  league: { path: string; leagueSlug: string; sport: string },
  signal?: AbortSignal,
): Promise<BovadaResult[]> {
  const url = `${BASE}/${league.path}?preMatchOnly=true&marketFilterId=def`
  let resp: Response
  try {
    resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Referer': 'https://www.bovada.lv/',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch (err: any) {
    console.warn(`[Bovada] fetch error`, { league: league.leagueSlug, message: err?.message ?? String(err) })
    return []
  }
  if (!resp.ok) {
    console.warn(`[Bovada] non-ok`, { league: league.leagueSlug, status: resp.status })
    return []
  }

  const body = await resp.json() as Array<{ events?: BvEvent[] }>
  const events: BvEvent[] = []
  for (const block of (body ?? [])) for (const e of (block.events ?? [])) events.push(e)

  const out: BovadaResult[] = []
  for (const e of events) {
    const competitors = e.competitors ?? []
    const home = competitors.find(c => c.home)?.name
    const away = competitors.find(c => !c.home)?.name
    if (!home || !away) continue
    if (!e.startTime) continue
    const startTime = new Date(e.startTime).toISOString()
    const externalId = String(e.id)

    // Walk the Game Lines displayGroup (and any group that contains the
    // relevant markets) to collect moneyline/spread/total.
    const markets: Record<'moneyline' | 'spread' | 'total', BvMarket | undefined> = {
      moneyline: undefined, spread: undefined, total: undefined,
    }
    for (const g of (e.displayGroups ?? [])) {
      for (const m of (g.markets ?? [])) {
        const t = classifyGameMarket(m)
        if (!t) continue
        if (!markets[t]) markets[t] = m
      }
    }

    const gameMarkets: BovadaGameMarket[] = []

    if (markets.moneyline) {
      let hp: number | null = null, ap: number | null = null
      for (const o of (markets.moneyline.outcomes ?? [])) {
        const price = parseAmerican(o.price?.american)
        if (price == null) continue
        const name = (o.description ?? '').toLowerCase()
        if (name === home.toLowerCase() || home.toLowerCase().includes(name)) hp = price
        else if (name === away.toLowerCase() || away.toLowerCase().includes(name)) ap = price
      }
      if (hp != null || ap != null) gameMarkets.push({
        marketType: 'moneyline',
        homePrice: hp, awayPrice: ap,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
      })
    }

    if (markets.spread) {
      let hp: number | null = null, ap: number | null = null, hLine: number | null = null
      for (const o of (markets.spread.outcomes ?? [])) {
        const price = parseAmerican(o.price?.american)
        const handicap = parseNumber(o.price?.handicap)
        if (price == null) continue
        const name = (o.description ?? '').toLowerCase()
        if (name === home.toLowerCase() || home.toLowerCase().includes(name)) {
          hp = price; if (handicap != null) hLine = handicap
        } else if (name === away.toLowerCase() || away.toLowerCase().includes(name)) {
          ap = price
        }
      }
      if (hp != null || ap != null) gameMarkets.push({
        marketType: 'spread',
        homePrice: hp, awayPrice: ap,
        spreadValue: hLine,
        totalValue: null, overPrice: null, underPrice: null,
      })
    }

    if (markets.total) {
      let op: number | null = null, up: number | null = null, totalVal: number | null = null
      for (const o of (markets.total.outcomes ?? [])) {
        const price = parseAmerican(o.price?.american)
        const handicap = parseNumber(o.price?.handicap)
        if (price == null) continue
        const name = (o.description ?? '').toLowerCase()
        if (name.startsWith('over') || name === 'o') {
          op = price; if (totalVal == null && handicap != null) totalVal = handicap
        } else if (name.startsWith('under') || name === 'u') {
          up = price
        }
      }
      if (op != null || up != null) gameMarkets.push({
        marketType: 'total',
        homePrice: null, awayPrice: null,
        spreadValue: null,
        totalValue: totalVal,
        overPrice: op, underPrice: up,
      })
    }

    if (gameMarkets.length === 0) continue

    out.push({
      event: {
        leagueSlug: league.leagueSlug,
        sport: league.sport,
        externalId,
        startTime,
        homeTeam: home,
        awayTeam: away,
      },
      gameMarkets,
      props: [],
      // Stash link for the per-event prop fetch.
      _link: e.link ?? null,
    } as BovadaResult & { _link: string | null })
  }

  return out as Array<BovadaResult & { _link: string | null }>
}

/**
 * Fetch per-event detail and parse player props from displayGroups.
 * The default league listing only ships "Game Lines" — the per-event
 * URL returns all 13 displayGroups including the prop buckets.
 */
async function fetchEventProps(
  link: string,
  signal?: AbortSignal,
): Promise<NormalizedProp[]> {
  const url = `${BASE}${link}`
  let resp: Response
  try {
    resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Referer': 'https://www.bovada.lv/',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch {
    return []
  }
  if (!resp.ok) return []

  let body: any
  try { body = await resp.json() } catch { return [] }
  const ev: BvEvent | undefined = body?.[0]?.events?.[0]
  if (!ev) return []

  const out: NormalizedProp[] = []
  // Dedup: one row per (player, category, line) — Bovada repeats the
  // same line under multiple displayGroups (Player Combos vs Game Props
  // vs Score Props) and we only want the first occurrence.
  const seen = new Set<string>()

  for (const g of (ev.displayGroups ?? [])) {
    for (const m of (g.markets ?? [])) {
      // Game-only — drop period-scoped props.
      if (m.period?.description && m.period.description !== 'Game') continue
      const desc = m.description ?? ''
      const category = classifyPropMarket(desc)
      if (!category) continue
      const playerRaw = extractPropPlayer(desc)
      if (!playerRaw) continue
      const playerName = normalizePlayerName(playerRaw)

      // One Bovada market often carries multiple alt lines as outcomes.
      // Group outcomes by handicap so each line gets its own row.
      type Pair = { over: number | null; under: number | null }
      const byLine = new Map<number, Pair>()
      for (const o of (m.outcomes ?? [])) {
        const price = parseAmerican(o.price?.american)
        const handicap = parseNumber(o.price?.handicap)
        if (price == null || handicap == null) continue
        const sideRaw = (o.description ?? '').toLowerCase().trim()
        const side = sideRaw.startsWith('over') || sideRaw === 'o' ? 'over'
          : sideRaw.startsWith('under') || sideRaw === 'u' ? 'under'
          : null
        if (!side) continue
        const pair = byLine.get(handicap) ?? { over: null, under: null }
        if (side === 'over') pair.over = price
        else pair.under = price
        byLine.set(handicap, pair)
      }

      for (const [line, pair] of byLine) {
        if (pair.over == null && pair.under == null) continue
        const key = `${playerName}|${category}|${line}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          propCategory: category,
          playerName,
          lineValue: line,
          overPrice: pair.over,
          underPrice: pair.under,
          yesPrice: null,
          noPrice: null,
          isBinary: false,
        })
      }
    }
  }
  return out
}

export async function scrapeBovada(
  signal?: AbortSignal,
): Promise<BovadaResult[]> {
  const out: BovadaResult[] = []
  for (const lg of LEAGUES) {
    if (signal?.aborted) break
    const leagueResults = await fetchLeague(lg, signal) as Array<BovadaResult & { _link: string | null }>
    let propTotal = 0

    // Per-event prop fetches, batched. Each request is tiny but we have
    // ~10-15 events per league and don't want to hammer Bovada with all
    // of them at once.
    const PROP_CONCURRENCY = 4
    for (let i = 0; i < leagueResults.length; i += PROP_CONCURRENCY) {
      if (signal?.aborted) break
      const batch = leagueResults.slice(i, i + PROP_CONCURRENCY)
      await Promise.all(batch.map(async (r) => {
        if (!r._link) return
        const props = await fetchEventProps(r._link, signal)
        r.props = props
        propTotal += props.length
      }))
    }

    console.log(`[Bovada:${lg.leagueSlug}] ${leagueResults.length} events, ${leagueResults.reduce((s, r) => s + r.gameMarkets.length, 0)} game markets, ${propTotal} props`)
    for (const r of leagueResults) {
      // Strip _link before emitting.
      const { _link, ...rest } = r
      out.push(rest)
    }
  }
  return out
}
