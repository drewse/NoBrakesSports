/**
 * BetOnline / LowVig / BUSR (shared offshore stack) adapter.
 *
 * Endpoint (reverse-engineered from DevTools cURL):
 *   POST https://api-offering.betonline.ag/api/offering/Sports/offering-by-league
 *   Body: { Sport, League, ScheduleText: null, filterTime: 0 }
 *   Headers: gsetting identifies the BetOnline SAS site — "bolsassite" for
 *   BetOnline. LowVig and BUSR are sister sites on the same platform; they
 *   are believed to use distinct gsetting values (lvsassite / busrsassite)
 *   but we configure per-operator with safe fallbacks.
 *
 * Cloudflare blocks direct datacenter IPs on the /api-offering/ host, so
 * the adapter routes every request through PROXY_URL (PacketStream
 * residential) via pipeFetch. Browser-indistinguishable headers.
 */

import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://api-offering.betonline.ag/api/offering/Sports/offering-by-league'

export interface BetOnlineOperator {
  slug: string          // our market_source slug
  name: string          // display name
  origin: string        // CORS origin sent to the API
  gsetting: string      // proprietary site identifier header
}

export const BETONLINE_OPERATORS: BetOnlineOperator[] = [
  { slug: 'betonline', name: 'BetOnline',
    origin: 'https://www.betonline.ag',
    gsetting: 'bolsassite' },
  { slug: 'lowvig',    name: 'LowVig',
    origin: 'https://www.lowvig.ag',
    gsetting: 'lvsassite' },
]

const LEAGUES: Array<{ sport: string; league: string; leagueSlug: string; canonicalSport: string }> = [
  { sport: 'basketball', league: 'nba', leagueSlug: 'nba', canonicalSport: 'basketball' },
  { sport: 'baseball',   league: 'mlb', leagueSlug: 'mlb', canonicalSport: 'baseball' },
  { sport: 'hockey',     league: 'nhl', leagueSlug: 'nhl', canonicalSport: 'ice_hockey' },
  { sport: 'football',   league: 'nfl', leagueSlug: 'nfl', canonicalSport: 'football' },
]

export interface BOLEvent {
  leagueSlug: string
  sport: string
  externalId: string
  startTime: string
  homeTeam: string
  awayTeam: string
}

export interface BOLGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface BOLResult {
  operatorSlug: string
  event: BOLEvent
  gameMarkets: BOLGameMarket[]
}

function parseAmerican(v: any): number | null {
  if (v == null) return null
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null
  const s = String(v).trim()
  if (!s || s === 'PK' || s === 'pk') return 100  // "pick" = even money
  const n = parseInt(s.replace(/^\+/, ''), 10)
  return isNaN(n) ? null : n
}
function parseNumber(v: any): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(n) ? n : null
}

async function fetchOperatorLeague(
  op: BetOnlineOperator,
  lg: typeof LEAGUES[number],
  signal?: AbortSignal,
): Promise<BOLResult[]> {
  let resp: Response
  try {
    resp = await pipeFetch(BASE, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'accept-language': 'en-US,en;q=0.9',
        'content-type': 'application/json',
        'gsetting': op.gsetting,
        'origin': op.origin,
        'referer': `${op.origin}/`,
        'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-site',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'utc-offset': '240',
      },
      body: JSON.stringify({ Sport: lg.sport, League: lg.league, ScheduleText: null, filterTime: 0 }),
      signal,
    })
  } catch (err: any) {
    console.warn(`[BetOnline:${op.slug}:${lg.leagueSlug}] fetch error`, { message: err?.message ?? String(err) })
    return []
  }
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    console.warn(`[BetOnline:${op.slug}:${lg.leagueSlug}] non-ok`, { status: resp.status, preview: errBody.slice(0, 200) })
    if (!__lastScrapeStats.sampleBody) {
      __lastScrapeStats.sampleBody = `HTTP ${resp.status}: ${errBody.slice(0, 3000)}`
    }
    return []
  }

  const bodyText = await resp.text()
  let body: any
  try { body = JSON.parse(bodyText) } catch {
    console.warn(`[BetOnline:${op.slug}:${lg.leagueSlug}] non-JSON body`, { preview: bodyText.slice(0, 200) })
    return []
  }
  // Expose raw body preview so the cron can echo the actual shape without
  // waiting on Vercel log indexing. Only set once to keep the response small.
  if (!__lastScrapeStats.sampleBody) {
    __lastScrapeStats.sampleBody = JSON.stringify(body).slice(0, 4000)
  }
  // Body shape is inferred — BetOnline wraps events in various containers.
  // Walk the response collecting objects that look like events.
  const events = collectEvents(body)

  const out: BOLResult[] = []
  for (const ev of events) {
    const r = mapEventToResult(ev, op.slug, lg)
    if (r) out.push(r)
  }
  return out
}

/** Walk the response body and collect event-shaped nodes. BetOnline wraps
 *  events inside a league-group hierarchy; we look for anything with
 *  {participants | competitors | teams} + {markets | lines | offerings}. */
function collectEvents(node: any): any[] {
  const out: any[] = []
  const seen = new Set<any>()
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (seen.has(n)) return
    seen.add(n)
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    const keys = Object.keys(n)
    const hasParts = keys.includes('participants') || keys.includes('competitors') || keys.includes('teams')
    const hasMarkets = keys.includes('markets') || keys.includes('lines') || keys.includes('offerings')
    const hasTitle = keys.includes('title') || keys.includes('description') || keys.includes('name')
    if ((hasParts && hasMarkets) || (hasMarkets && hasTitle && (n.id || n.EventId || n.eventId))) {
      out.push(n)
    }
    for (const v of Object.values(n)) walk(v)
  }
  walk(node)
  return out
}

function mapEventToResult(ev: any, operatorSlug: string, lg: typeof LEAGUES[number]): BOLResult | null {
  const externalId = String(ev.id ?? ev.EventId ?? ev.eventId ?? '')
  if (!externalId) return null
  const startMs = ev.startTime ?? ev.startDate ?? ev.eventDate ?? ev.starts ?? ev.date
  const startTime = typeof startMs === 'number' ? new Date(startMs).toISOString()
    : typeof startMs === 'string' ? new Date(startMs).toISOString()
    : null
  if (!startTime) return null

  // Extract participants. Shapes observed across offshore sportsbook APIs:
  //   participants: [{ name, home: bool }]
  //   teams: { home: { name }, away: { name } }
  //   competitors: [{ name, isHome }]
  let home: string | undefined, away: string | undefined
  if (Array.isArray(ev.participants)) {
    home = ev.participants.find((p: any) => p?.home || p?.isHome || p?.side === 'home')?.name
    away = ev.participants.find((p: any) => p?.away || (!p?.home && !p?.isHome))?.name
    if (!home && ev.participants.length === 2) { away = ev.participants[0]?.name; home = ev.participants[1]?.name }
  } else if (ev.teams && (ev.teams.home || ev.teams.away)) {
    home = ev.teams.home?.name
    away = ev.teams.away?.name
  } else if (Array.isArray(ev.competitors)) {
    home = ev.competitors.find((c: any) => c?.home || c?.isHome)?.name
    away = ev.competitors.find((c: any) => !(c?.home || c?.isHome))?.name
  }
  // Fallback: parse from title like "Away @ Home" or "Away vs Home"
  if ((!home || !away) && (ev.title || ev.description || ev.name)) {
    const title = String(ev.title ?? ev.description ?? ev.name)
    const at = title.search(/\s+@\s+|\s+at\s+/i)
    if (at > 0) { away = title.slice(0, at).trim(); home = title.replace(/^[^@]+(?:@|at)\s+/i, '').trim() }
  }
  if (!home || !away) return null

  const markets = ev.markets ?? ev.lines ?? ev.offerings ?? []
  const gm: BOLGameMarket[] = []

  const pickByType = (typeMatch: RegExp) => {
    for (const m of (Array.isArray(markets) ? markets : [])) {
      const label = String(m?.description ?? m?.name ?? m?.title ?? m?.marketType ?? '').toLowerCase()
      if (typeMatch.test(label)) return m
    }
    return null
  }

  const ml = pickByType(/^money\s*line|^moneyline|match\s*winner/)
  if (ml) {
    let hp: number | null = null, ap: number | null = null
    for (const o of (ml.outcomes ?? ml.selections ?? ml.participants ?? [])) {
      const name = String(o?.description ?? o?.name ?? '').toLowerCase()
      const price = parseAmerican(o?.price?.american ?? o?.american ?? o?.americanOdds ?? o?.price)
      if (price == null) continue
      if (name.includes(home.toLowerCase()) || home.toLowerCase().includes(name)) hp = price
      else if (name.includes(away.toLowerCase()) || away.toLowerCase().includes(name)) ap = price
    }
    if (hp != null || ap != null) gm.push({
      marketType: 'moneyline',
      homePrice: hp, awayPrice: ap,
      spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
    })
  }

  const spread = pickByType(/point\s*spread|\brun\s*line|\bpuck\s*line|\bspread\b|handicap/)
  if (spread) {
    let hp: number | null = null, ap: number | null = null, line: number | null = null
    for (const o of (spread.outcomes ?? spread.selections ?? spread.participants ?? [])) {
      const name = String(o?.description ?? o?.name ?? '').toLowerCase()
      const price = parseAmerican(o?.price?.american ?? o?.american ?? o?.americanOdds ?? o?.price)
      const handicap = parseNumber(o?.handicap ?? o?.line ?? o?.points ?? o?.price?.handicap)
      if (price == null) continue
      if (name.includes(home.toLowerCase()) || home.toLowerCase().includes(name)) {
        hp = price; if (line == null && handicap != null) line = handicap
      } else if (name.includes(away.toLowerCase()) || away.toLowerCase().includes(name)) {
        ap = price
      }
    }
    if (hp != null || ap != null) gm.push({
      marketType: 'spread',
      homePrice: hp, awayPrice: ap, spreadValue: line,
      totalValue: null, overPrice: null, underPrice: null,
    })
  }

  const tot = pickByType(/^total|over\/?under|\btotals\b/)
  if (tot) {
    let op: number | null = null, up: number | null = null, total: number | null = null
    for (const o of (tot.outcomes ?? tot.selections ?? tot.participants ?? [])) {
      const name = String(o?.description ?? o?.name ?? '').toLowerCase()
      const price = parseAmerican(o?.price?.american ?? o?.american ?? o?.americanOdds ?? o?.price)
      const handicap = parseNumber(o?.handicap ?? o?.line ?? o?.points ?? o?.price?.handicap)
      if (price == null) continue
      if (name.startsWith('over') || name === 'o') { op = price; if (total == null && handicap != null) total = handicap }
      else if (name.startsWith('under') || name === 'u') { up = price }
    }
    if (op != null || up != null) gm.push({
      marketType: 'total',
      homePrice: null, awayPrice: null, spreadValue: null,
      totalValue: total, overPrice: op, underPrice: up,
    })
  }

  if (gm.length === 0) return null

  return {
    operatorSlug,
    event: {
      leagueSlug: lg.leagueSlug,
      sport: lg.canonicalSport,
      externalId,
      startTime,
      homeTeam: home,
      awayTeam: away,
    },
    gameMarkets: gm,
  }
}

// Diagnostic counters exposed so the cron response can echo them.
export const __lastScrapeStats = {
  sampleBody: '' as string,
  perOperator: {} as Record<string, { requested: number; eventsFound: number; markets: number }>,
}

export async function scrapeBetOnline(
  signal?: AbortSignal,
): Promise<BOLResult[]> {
  __lastScrapeStats.sampleBody = ''
  __lastScrapeStats.perOperator = {}
  const out: BOLResult[] = []
  for (const op of BETONLINE_OPERATORS) {
    __lastScrapeStats.perOperator[op.slug] = { requested: LEAGUES.length, eventsFound: 0, markets: 0 }
    for (const lg of LEAGUES) {
      if (signal?.aborted) break
      const res = await fetchOperatorLeague(op, lg, signal)
      console.log(`[BetOnline:${op.slug}:${lg.leagueSlug}] ${res.length} events`)
      for (const r of res) out.push(r)
      __lastScrapeStats.perOperator[op.slug].eventsFound += res.length
      __lastScrapeStats.perOperator[op.slug].markets += res.reduce((s, r) => s + r.gameMarkets.length, 0)
    }
  }
  return out
}
