/**
 * BetVictor (Ontario) — real adapter.
 *
 * Platform: BetVictor native (betvictor.com/en-ca).
 *
 * Discovered endpoints:
 *   GET /sportsbook_components/home_components/components/:id?c=en-ca
 *        → FeaturedComponent { sport: { eventIds[] }, events[], markets[], outcomes[] }
 *   GET /api/sports?l=en-ca
 *        → list of sports with id + event_path_id + description
 *
 * Strategy: seed the en-ca sports homepage so the SPA prefetches the
 * FeaturedComponent blocks, passively capture every
 * /sportsbook_components/home_components/components/ body, then walk the
 * inlined events/markets/outcomes.
 *
 * This is NOT comprehensive — featured components only surface hot leagues
 * (NBA / NHL / MLB during their seasons). That's the same slice the other
 * adapters target for v1, so it lines up.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedEvent } from '../lib/types.js'

// Deep-seed directly into NBA so the sportsbook component fires — the
// bare /en-ca/sports route renders a promo that doesn't hydrate market data.
const SEED_URL = 'https://www.betvictor.com/en-ca/sports/basketball/nba'
// Actual data endpoints observed on the NBA page:
//   /horizon/betvictor       — main sportsbook data API
//   /api/left_components     — left-rail components (often carry the event list)
//   /api/right_components    — right-rail components (featured / odds boosts)
//   /sportsbook_components/… — legacy home-page featured components (rare on league pages)
const FEATURED_URL_RE = /\/horizon\/betvictor|\/api\/(left|right)_components|\/sportsbook_components\//

const LEAGUE_MAP: Array<{ match: RegExp; leagueSlug: string; sport: string }> = [
  { match: /\bNBA\b/i,               leagueSlug: 'nba',        sport: 'basketball' },
  { match: /\bNHL\b/i,               leagueSlug: 'nhl',        sport: 'ice_hockey' },
  { match: /\bMLB\b/i,               leagueSlug: 'mlb',        sport: 'baseball'   },
  { match: /Premier League/i,        leagueSlug: 'epl',        sport: 'soccer'     },
  { match: /La ?Liga/i,              leagueSlug: 'laliga',     sport: 'soccer'     },
  { match: /Bundesliga/i,            leagueSlug: 'bundesliga', sport: 'soccer'     },
  { match: /Serie ?A/i,              leagueSlug: 'seria_a',    sport: 'soccer'     },
  { match: /Ligue ?1|Ligue ?One/i,   leagueSlug: 'ligue_one',  sport: 'soccer'     },
]

/** BetVictor outcomes carry fractional ("10/11") or decimal numbers under
 *  fields like `odds_fractional` / `odds_decimal`. */
function fractionalToAmerican(frac: string): number | null {
  const slash = frac.indexOf('/')
  if (slash === -1) return null
  const num = Number(frac.slice(0, slash))
  const den = Number(frac.slice(slash + 1))
  if (!isFinite(num) || !isFinite(den) || den === 0) return null
  const f = num / den
  return f >= 1 ? Math.round(f * 100) : Math.round(-(den / num) * 100)
}
function decimalToAmerican(d: number): number | null {
  if (!isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}
function priceOf(o: any): number | null {
  if (o == null) return null
  if (typeof o.odds_decimal === 'number') return decimalToAmerican(o.odds_decimal)
  if (typeof o.odds_decimal === 'string') {
    const n = Number(o.odds_decimal); if (!isNaN(n)) return decimalToAmerican(n)
  }
  if (typeof o.odds_fractional === 'string') return fractionalToAmerican(o.odds_fractional)
  if (typeof o.odds_american === 'number') return Math.round(o.odds_american)
  if (typeof o.decimal_price === 'number') return decimalToAmerican(o.decimal_price)
  if (typeof o.price === 'number') return decimalToAmerican(o.price)
  return null
}

function classifyMarket(label: string): 'moneyline' | 'spread' | 'total' | null {
  const n = label.toLowerCase()
  if (/\b(1st|2nd|3rd|4th|first|second|third|fourth|half|quarter|inning|period|race to|alt)\b/.test(n)) return null
  if (/money\s*line|moneyline|match\s*winner|match\s*betting|1x2|to\s*win\b/.test(n)) return 'moneyline'
  if (/run\s*line|puck\s*line|point\s*spread|\bspread\b|handicap/.test(n)) return 'spread'
  if (/\btotal\b|over\/?under|over\s*\/\s*under|totals|match\s*goals/.test(n)) return 'total'
  return null
}

interface BvOutcome {
  id: number | string
  description?: string
  name?: string
  odds_decimal?: string | number
  odds_fractional?: string
  odds_american?: number
  handicap?: number | string
  total?: number | string
  market_id?: number | string
}
interface BvMarket {
  id: number | string
  description?: string
  name?: string
  display_name?: string
  template?: string
  market_type_id?: number
  event_id?: number | string
  outcome_ids?: Array<number | string>
  main?: boolean
  is_main?: boolean
}
interface BvEvent {
  id: number | string
  description?: string
  home_team?: string
  away_team?: string
  home_name?: string
  away_name?: string
  home?: { description?: string; name?: string }
  away?: { description?: string; name?: string }
  participants?: Array<{ description?: string; name?: string; role?: string; home?: boolean }>
  start_time?: string
  scheduled_start?: string
  market_ids?: Array<number | string>
}

function teamsOf(e: BvEvent): { home: string; away: string } | null {
  const s = (x: any): string => (typeof x === 'string' ? x : (x?.description ?? x?.name ?? '')) || ''
  const home = s(e.home_team) || s(e.home_name) || s(e.home)
  const away = s(e.away_team) || s(e.away_name) || s(e.away)
  if (home && away) return { home, away }
  if (Array.isArray(e.participants) && e.participants.length >= 2) {
    const h = e.participants.find(p => p.home === true || p.role === 'home')
    const a = e.participants.find(p => p !== h)
    if (h && a) {
      const hn = s(h), an = s(a)
      if (hn && an) return { home: hn, away: an }
    }
  }
  // description often "Home v Away" or "Home vs Away"
  if (typeof e.description === 'string') {
    const m = e.description.match(/^(.+?)\s+(?:vs|v\.?)\s+(.+)$/i)
    if (m) return { home: m[1].trim(), away: m[2].trim() }
  }
  return null
}

function startOf(e: BvEvent): string | null {
  return (typeof e.start_time === 'string' && e.start_time.length >= 10) ? e.start_time
       : (typeof e.scheduled_start === 'string' && e.scheduled_start.length >= 10) ? e.scheduled_start
       : null
}

function extractFromComponent(
  body: any,
  agg: {
    events: Map<number | string, BvEvent>
    markets: Map<number | string, BvMarket>
    outcomes: Map<number | string, BvOutcome>
    leagueByEvent: Map<number | string, { leagueSlug: string; sport: string }>
  },
): void {
  const walk = (node: any, context: { leagueSlug?: string; sport?: string }) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n, context) ; return }
    // Identify league context: FeaturedComponent carries sport.description like "Hockey | NHL"
    if (node.type === 'FeaturedComponent' && node.sport?.description) {
      const desc = String(node.sport.description)
      const hit = LEAGUE_MAP.find(l => l.match.test(desc))
      if (hit) context = { leagueSlug: hit.leagueSlug, sport: hit.sport }
    }
    // Event-shaped?
    const hasId = (node.id != null || node.event_id != null)
    if (hasId) {
      const looksEvent = Array.isArray(node.market_ids) || node.home_team || node.away_team || node.home_name || node.away_name || node.home || node.away
      const looksMarket = node.outcome_ids || node.market_type_id || node.template
      const looksOutcome = node.odds_decimal != null || node.odds_fractional != null || node.odds_american != null
      if (looksEvent) {
        const id = node.id ?? node.event_id
        if (!agg.events.has(id)) agg.events.set(id, node as BvEvent)
        if (context.leagueSlug && context.sport && !agg.leagueByEvent.has(id)) {
          agg.leagueByEvent.set(id, { leagueSlug: context.leagueSlug, sport: context.sport })
        }
      } else if (looksMarket) {
        const id = node.id
        if (id != null && !agg.markets.has(id)) agg.markets.set(id, node as BvMarket)
      } else if (looksOutcome) {
        const id = node.id
        if (id != null && !agg.outcomes.has(id)) agg.outcomes.set(id, node as BvOutcome)
      }
    }
    for (const v of Object.values(node)) walk(v, context)
  }
  walk(body, {})
}

function buildGameMarkets(
  ev: BvEvent,
  home: string,
  away: string,
  markets: Map<number | string, BvMarket>,
  outcomes: Map<number | string, BvOutcome>,
): GameMarket[] {
  const evMarkets = (ev.market_ids ?? []).map(id => markets.get(id)).filter(Boolean) as BvMarket[]
  if (evMarkets.length === 0) return []

  const byType: Record<'moneyline' | 'spread' | 'total', BvMarket[]> = { moneyline: [], spread: [], total: [] }
  for (const m of evMarkets) {
    const label = String(m.display_name ?? m.description ?? m.name ?? m.template ?? '')
    const t = classifyMarket(label)
    if (!t) continue
    byType[t].push(m)
  }

  const out: GameMarket[] = []
  const nameOf = (o: BvOutcome | undefined) => String(o?.description ?? o?.name ?? '').toLowerCase()
  const lineOf = (o: BvOutcome | undefined): number | null => {
    if (!o) return null
    for (const k of ['handicap', 'total', 'line'] as const) {
      const v = (o as any)[k]
      if (typeof v === 'number' && isFinite(v)) return v
      if (typeof v === 'string') { const n = Number(v); if (!isNaN(n)) return n }
    }
    return null
  }

  const outcomesFor = (m: BvMarket): BvOutcome[] =>
    (m.outcome_ids ?? []).map(id => outcomes.get(id)).filter(Boolean) as BvOutcome[]

  // Moneyline
  if (byType.moneyline[0]) {
    const m = byType.moneyline.find(x => x.main === true || x.is_main === true) ?? byType.moneyline[0]
    let hp: number | null = null, ap: number | null = null
    for (const o of outcomesFor(m)) {
      const n = nameOf(o), p = priceOf(o)
      if (p == null) continue
      if (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n)) hp = p
      else if (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n)) ap = p
    }
    if (hp != null || ap != null) {
      out.push({
        marketType: 'moneyline',
        homePrice: hp, awayPrice: ap, drawPrice: null,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
      })
    }
  }

  // Spread — pick by -110 proximity
  {
    let best: { hp: number | null; ap: number | null; spread: number | null } | null = null
    let bestScore = Infinity
    for (const m of byType.spread) {
      let hp: number | null = null, ap: number | null = null, spread: number | null = null
      for (const o of outcomesFor(m)) {
        const n = nameOf(o), p = priceOf(o), line = lineOf(o)
        if (p == null) continue
        if (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n)) {
          hp = p; if (spread == null && line != null) spread = line
        } else if (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n)) {
          ap = p; if (spread == null && line != null) spread = -line
        }
      }
      if (hp == null && ap == null) continue
      const score = Math.abs((hp ?? -110) + 110) + Math.abs((ap ?? -110) + 110)
      if (score < bestScore) { bestScore = score; best = { hp, ap, spread } }
    }
    if (best) {
      out.push({
        marketType: 'spread',
        homePrice: best.hp, awayPrice: best.ap, drawPrice: null,
        spreadValue: best.spread, totalValue: null, overPrice: null, underPrice: null,
      })
    }
  }

  // Total
  {
    let best: { op: number | null; up: number | null; total: number | null } | null = null
    let bestScore = Infinity
    for (const m of byType.total) {
      let op: number | null = null, up: number | null = null, total: number | null = null
      for (const o of outcomesFor(m)) {
        const n = nameOf(o), p = priceOf(o), line = lineOf(o)
        if (p == null) continue
        if (n.startsWith('over') || n === 'o') { op = p; if (total == null) total = line }
        else if (n.startsWith('under') || n === 'u') { up = p; if (total == null) total = line }
      }
      if (op == null && up == null) continue
      const score = Math.abs((op ?? -110) + 110) + Math.abs((up ?? -110) + 110)
      if (score < bestScore) { bestScore = score; best = { op, up, total } }
    }
    if (best) {
      out.push({
        marketType: 'total',
        homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
        totalValue: best.total, overPrice: best.op, underPrice: best.up,
      })
    }
  }

  return out
}

export const betvictorAdapter: BookAdapter = {
  slug: 'betvictor',
  name: 'BetVictor (Ontario)',
  pollIntervalSec: 300,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      // Passive capture of component bodies the SPA fetches on render,
      // plus a diagnostic tally of every JSON path seen so we can confirm
      // which components fire on NBA/MLB/NHL pages.
      const bodies: string[] = []
      const seenPaths = new Map<string, number>()
      const responseHandler = async (resp: import('playwright').Response) => {
        const u = resp.url()
        const ct = (resp.headers()['content-type'] ?? '').toLowerCase()
        if (ct.includes('json') && u.includes('betvictor.com')) {
          try {
            const p = new URL(u).pathname
              .replace(/\/\d{3,}/g, '/:id')
              .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
            seenPaths.set(p, (seenPaths.get(p) ?? 0) + 1)
          } catch { /* ignore */ }
        }
        if (!FEATURED_URL_RE.test(u)) return
        if (resp.status() !== 200) return
        try { bodies.push(await resp.text()) } catch { /* stream closed */ }
      }
      page.on('response', responseHandler)

      log.info('betvictor seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        errors.push(`seed: ${e?.message ?? e}`)
        log.error('betvictor seed failed', { message: e?.message ?? String(e) })
        page.off('response', responseHandler)
        return { events: scraped, errors }
      }
      // Give SPA time to fetch all home-component blocks.
      await page.waitForTimeout(12_000)

      // Drill into sport pages to surface more components if home didn't carry them.
      for (const path of ['basketball/nba', 'ice-hockey/nhl', 'baseball/mlb']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://www.betvictor.com/en-ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }
      page.off('response', responseHandler)
      log.info('betvictor captured', {
        componentBodies: bodies.length,
        topJsonPaths: Array.from(seenPaths.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20),
      })

      const agg = {
        events: new Map<number | string, BvEvent>(),
        markets: new Map<number | string, BvMarket>(),
        outcomes: new Map<number | string, BvOutcome>(),
        leagueByEvent: new Map<number | string, { leagueSlug: string; sport: string }>(),
      }
      for (const body of bodies) {
        try { extractFromComponent(JSON.parse(body), agg) } catch { /* skip */ }
      }
      log.info('betvictor aggregate', {
        events: agg.events.size,
        markets: agg.markets.size,
        outcomes: agg.outcomes.size,
      })
      // If extraction found nothing, dump the first body so we can see the
      // real shape the new endpoints ship.
      if (agg.events.size === 0 && bodies.length > 0) {
        try {
          const parsed = JSON.parse(bodies[0])
          log.info('betvictor raw body sample', {
            topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 30) : null,
            body: JSON.stringify(parsed).slice(0, 2500),
          })
        } catch { /* skip */ }
      }

      for (const [eid, ev] of agg.events) {
        const league = agg.leagueByEvent.get(eid)
        if (!league) continue   // only keep events we could league-classify
        const teams = teamsOf(ev)
        const start = startOf(ev)
        if (!teams || !start) continue
        const gameMarkets = buildGameMarkets(ev, teams.home, teams.away, agg.markets, agg.outcomes)
        scraped.push({
          event: {
            externalId: String(eid),
            homeTeam: teams.home,
            awayTeam: teams.away,
            startTime: start,
            leagueSlug: league.leagueSlug,
            sport: league.sport,
          },
          gameMarkets,
          props: [],
        })
      }

      log.info('betvictor scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
