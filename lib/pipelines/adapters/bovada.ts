/**
 * Bovada (offshore, Curaçao-licensed) adapter.
 *
 * Endpoint (public JSON, no auth):
 *   GET /services/sports/event/coupon/events/A/description/{sport}/{league}
 *       ?preMatchOnly=true&marketFilterId=def
 *
 * Response shape:
 *   [{ path:[...], events:[{
 *       id, description: "Away @ Home", startTime: <epoch ms>,
 *       competitors: [{ name, home: bool }, ...],
 *       displayGroups: [{ description, markets: [{
 *         description, period: { description },
 *         outcomes: [{ description, price: { american, decimal } }]
 *       }] }]
 *   }] }]
 *
 * Relevant markets (pulled from the "Game Lines" displayGroup):
 *   "Moneyline"         → moneyline (home/away prices)
 *   "Point Spread"      → spread (spread value + home/away prices)
 *   "Total"             → total (total value + over/under prices)
 *   "Run Line"          → MLB spread
 *   "Puck Line"         → NHL spread
 *   "Total Runs"        → MLB total
 *   "Total Goals"       → NHL total
 *
 * We only take markets whose period.description === "Game" to filter out
 * 1st half / quarter / inning period markets.
 */

import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://www.bovada.lv/services/sports/event/coupon/events/A/description'

const LEAGUES: Array<{ path: string; leagueSlug: string; sport: string }> = [
  { path: 'basketball/nba', leagueSlug: 'nba', sport: 'basketball' },
  { path: 'baseball/mlb',   leagueSlug: 'mlb', sport: 'baseball' },
  { path: 'hockey/nhl',     leagueSlug: 'nhl', sport: 'ice_hockey' },
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
  competitors?: BvCompetitor[]
  displayGroups?: Array<{ description?: string; markets?: BvMarket[] }>
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
    resp = await pipeFetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal,
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
    })
  }

  return out
}

export async function scrapeBovada(
  signal?: AbortSignal,
): Promise<BovadaResult[]> {
  const out: BovadaResult[] = []
  for (const lg of LEAGUES) {
    if (signal?.aborted) break
    const res = await fetchLeague(lg, signal)
    console.log(`[Bovada:${lg.leagueSlug}] ${res.length} events, ${res.reduce((s, r) => s + r.gameMarkets.length, 0)} markets`)
    for (const r of res) out.push(r)
  }
  return out
}
