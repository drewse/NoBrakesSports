/**
 * Fanatics Markets (prediction market / CFTC DCM) adapter.
 *
 * Endpoint:
 *   GET https://api.fanaticsmarkets.com/events?series={NBA|MLB|NHL|NFL}
 *     No auth, no geo block, no CF. Returns { data: FanaticsEvent[] } with
 *     per-event moneyline / spread / over_and_under / player_prop contracts.
 *
 * Shape: contracts use `probability` (0-1) rather than American odds. For
 *   symmetric two-sided markets, we convert to American via p ↔ price.
 *
 * KNOWN LIMITATION (first probe, 2026-04-22):
 *   The REST endpoint currently returns `probability: 0.5` for every
 *   contract outcome on every league. Fanatics Markets launched very
 *   recently and live bid/ask pricing likely flows over WebSocket only;
 *   the REST response is seeded with the notional 50/50 until trading
 *   activates. We ship the adapter anyway — the moment real prices land
 *   on the REST endpoint we capture them automatically.
 */

const BASE = 'https://api.fanaticsmarkets.com/events'

const LEAGUES: Array<{ seriesParam: string; leagueSlug: string; sport: string }> = [
  { seriesParam: 'NBA', leagueSlug: 'nba', sport: 'basketball' },
  { seriesParam: 'MLB', leagueSlug: 'mlb', sport: 'baseball'   },
  { seriesParam: 'NHL', leagueSlug: 'nhl', sport: 'ice_hockey' },
  { seriesParam: 'NFL', leagueSlug: 'nfl', sport: 'football'   },
]

export interface FanaticsEvent {
  leagueSlug: string
  sport: string
  externalId: string
  startTime: string
  homeTeam: string
  awayTeam: string
}

export interface FanaticsGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface FanaticsResult {
  event: FanaticsEvent
  gameMarkets: FanaticsGameMarket[]
}

/** Convert a probability (0-1) to an American odds integer.
 *  Returns null for non-finite / out-of-range inputs, and also for the
 *  placeholder `0.5` Fanatics returns on contracts that haven't started
 *  trading yet — a real prediction-market bid/ask is never exactly 0.5,
 *  so treating it as a sentinel filters out all the fake +100/-100 rows
 *  that otherwise surface as huge phantom +EV opportunities. */
export function probabilityToAmerican(p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null
  // Fanatics seeds every contract with a near-0.5 placeholder on events
  // that haven't started trading. Widened from `=== 0.5` to a narrow
  // neighborhood because the API was also emitting 0.4999/0.5001 — still
  // within the placeholder band, never a real price. A genuine live
  // market moves off this range within seconds of the first trade.
  if (p >= 0.495 && p <= 0.505) return null
  // Decimal odds = 1/p; then decimal→American.
  const d = 1 / p
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

async function fetchSeries(seriesParam: string, signal?: AbortSignal): Promise<any[]> {
  const url = `${BASE}?series=${encodeURIComponent(seriesParam)}`
  let resp: Response
  try {
    resp = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Origin': 'https://fanaticsmarkets.com',
        'Referer': 'https://fanaticsmarkets.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal,
    })
  } catch (err: any) {
    console.warn(`[FanaticsMarkets] fetch error`, { series: seriesParam, message: err?.message ?? String(err) })
    return []
  }
  if (!resp.ok) {
    console.warn(`[FanaticsMarkets] non-ok`, { series: seriesParam, status: resp.status })
    return []
  }
  const body = await resp.json().catch(() => null) as { data?: any[] } | null
  return Array.isArray(body?.data) ? body!.data : []
}

function mapEvent(ev: any, lg: typeof LEAGUES[number]): FanaticsResult | null {
  const externalId = String(ev?.id ?? '')
  if (!externalId) return null
  const startMs = ev?.startTime
  const startTime = typeof startMs === 'number' ? new Date(startMs).toISOString()
    : typeof startMs === 'string' ? new Date(startMs).toISOString()
    : null
  if (!startTime) return null

  const a = ev?.matchupProps?.sideA
  const b = ev?.matchupProps?.sideB
  const home = (a?.homeAway === 'HOME' ? a : b?.homeAway === 'HOME' ? b : null)?.name
  const away = (a?.homeAway === 'AWAY' ? a : b?.homeAway === 'AWAY' ? b : null)?.name
  if (!home || !away) return null

  const markets = ev?.markets ?? {}
  const gm: FanaticsGameMarket[] = []

  // Moneyline — two outcomes, HOME / AWAY
  const ml: any[] = Array.isArray(markets.moneyline) ? markets.moneyline : []
  if (ml.length >= 2) {
    let hp: number | null = null, ap: number | null = null
    for (const o of ml) {
      const price = probabilityToAmerican(o?.probability)
      if (price == null) continue
      if (o?.outcomeType === 'HOME') hp = price
      else if (o?.outcomeType === 'AWAY') ap = price
    }
    if (hp != null || ap != null) gm.push({
      marketType: 'moneyline',
      homePrice: hp, awayPrice: ap,
      spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
    })
  }

  // Spread — main line is the pair with balanced sides (probability closest
  // to 0.5). Fanatics often lists a ladder of alt-spreads per event; we take
  // only the market line.
  const spreadOpts: any[] = Array.isArray(markets.spread) ? markets.spread : []
  if (spreadOpts.length >= 2) {
    // Group HOME / AWAY entries per line, pick the balanced pair.
    const byLine = new Map<number, { home?: any; away?: any }>()
    for (const o of spreadOpts) {
      if (typeof o?.line !== 'number') continue
      const ln = o.line
      const bucket = byLine.get(ln) ?? {}
      if (o.outcomeType === 'HOME') bucket.home = o
      else if (o.outcomeType === 'AWAY') bucket.away = o
      byLine.set(ln, bucket)
    }
    let best: { hp: number | null; ap: number | null; line: number } | null = null
    let bestScore = Infinity
    for (const [line, { home: h, away: a }] of byLine) {
      const hp = h ? probabilityToAmerican(h.probability) : null
      const ap = a ? probabilityToAmerican(a.probability) : null
      if (hp == null && ap == null) continue
      const score = Math.abs((hp ?? 0) - (ap ?? 0))
      if (score < bestScore) { bestScore = score; best = { hp, ap, line } }
    }
    if (best) gm.push({
      marketType: 'spread',
      homePrice: best.hp, awayPrice: best.ap,
      spreadValue: best.line, totalValue: null, overPrice: null, underPrice: null,
    })
  }

  // Total — over/under pairs by line
  const totalOpts: any[] = Array.isArray(markets.over_and_under) ? markets.over_and_under : []
  if (totalOpts.length >= 2) {
    const byLine = new Map<number, { over?: any; under?: any }>()
    for (const o of totalOpts) {
      if (typeof o?.line !== 'number') continue
      const ln = o.line
      const bucket = byLine.get(ln) ?? {}
      if (o.outcomeType === 'OVER') bucket.over = o
      else if (o.outcomeType === 'UNDER') bucket.under = o
      byLine.set(ln, bucket)
    }
    let best: { op: number | null; up: number | null; line: number } | null = null
    let bestScore = Infinity
    for (const [line, { over: o, under: u }] of byLine) {
      const op = o ? probabilityToAmerican(o.probability) : null
      const up = u ? probabilityToAmerican(u.probability) : null
      if (op == null && up == null) continue
      const score = Math.abs((op ?? 0) - (up ?? 0))
      if (score < bestScore) { bestScore = score; best = { op, up, line } }
    }
    if (best) gm.push({
      marketType: 'total',
      homePrice: null, awayPrice: null,
      spreadValue: null, totalValue: best.line,
      overPrice: best.op, underPrice: best.up,
    })
  }

  return {
    event: {
      externalId,
      homeTeam: home,
      awayTeam: away,
      startTime,
      leagueSlug: lg.leagueSlug,
      sport: lg.sport,
    },
    gameMarkets: gm,
  }
}

export async function scrapeFanaticsMarkets(signal?: AbortSignal): Promise<FanaticsResult[]> {
  const out: FanaticsResult[] = []
  for (const lg of LEAGUES) {
    if (signal?.aborted) break
    const data = await fetchSeries(lg.seriesParam, signal)
    console.log(`[FanaticsMarkets:${lg.leagueSlug}] ${data.length} events`)
    for (const ev of data) {
      const r = mapEvent(ev, lg)
      if (r) out.push(r)
    }
  }
  return out
}
