/**
 * 888sport (Ontario) — real adapter.
 *
 * Platform: Spectate Gaming (spectate-web.888sport.ca).
 *
 * Endpoint (confirmed via discovery):
 *   GET https://spectate-web.888sport.ca/spectate/sportsbook-req/getTournamentMatches/{sport}/{country}/{league}
 *   Response:
 *     {
 *       selection_pointers: [{ event_id, market_id }],
 *       events: { "<event_id>": { ... event + markets ... } },
 *       event_order: [event_id, ...],
 *     }
 *
 * Strategy: seed an NBA page so Spectate issues its tournament XHRs and
 * provisions session cookies, then call the getTournamentMatches endpoint
 * for each (sport, country, league) we care about from inside the page
 * context so cookies come along for the ride.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedEvent } from '../lib/types.js'

const SEED_URL = 'https://www.888sport.ca/basketball/united-states/nba-t-563941/'
const API_HOST = 'https://spectate-web.888sport.ca'

interface LeagueCfg {
  sport: 'basketball' | 'baseball' | 'ice-hockey'
  country: string
  league: string
  leagueSlug: string
  sportCanonical: string
}

const LEAGUES: LeagueCfg[] = [
  { sport: 'basketball', country: 'united-states', league: 'nba', leagueSlug: 'nba', sportCanonical: 'basketball' },
  { sport: 'baseball',   country: 'united-states', league: 'mlb', leagueSlug: 'mlb', sportCanonical: 'baseball' },
  { sport: 'ice-hockey', country: 'united-states', league: 'nhl', leagueSlug: 'nhl', sportCanonical: 'ice_hockey' },
]

/** Spectate selections ship `fraction_price` ("10/11") plus sometimes
 *  `decimal_price` — convert either to American. */
function fractionalToAmerican(frac: string): number | null {
  const slash = frac.indexOf('/')
  if (slash === -1) return null
  const num = Number(frac.slice(0, slash))
  const den = Number(frac.slice(slash + 1))
  if (!isFinite(num) || !isFinite(den) || den === 0) return null
  const f = num / den
  return f >= 1 ? Math.round(f * 100) : Math.round(-(den / num) * 100)
}

function toAmerican(x: any): number | null {
  if (x == null) return null
  if (typeof x === 'string') {
    if (x.includes('/')) return fractionalToAmerican(x)
    const n = Number(x)
    if (!isNaN(n)) return toAmerican(n)
  }
  const n = typeof x === 'number' ? x : Number(x)
  if (!isFinite(n)) return null
  if (n >= 1.01 && n <= 50) {
    if (n >= 2) return Math.round((n - 1) * 100)
    return Math.round(-100 / (n - 1))
  }
  if (n >= 100 || n <= -100) return Math.round(n)
  return null
}

/** Spectate uses market_type_id to identify game markets. Seen in the
 *  discovery sample: 1312002, 1356470, 1334087. Without a labelled dictionary
 *  we classify by outcome content (home/away team match, Over/Under prefix). */
function classifyMarket(marketLabel: string): 'moneyline' | 'spread' | 'total' | null {
  const n = marketLabel.toLowerCase()
  if (/\b(1st|2nd|3rd|4th|first|second|third|fourth|half|quarter|inning|period|race to|alt)\b/.test(n)) return null
  if (/money\s*line|moneyline|match\s*winner|to\s*win\b/.test(n)) return 'moneyline'
  if (/run\s*line|puck\s*line|point\s*spread|\bspread\b|handicap/.test(n)) return 'spread'
  if (/\btotal\b|over\/?under|over\s*\/\s*under|totals/.test(n)) return 'total'
  return null
}

interface SpectateEvent {
  id: number
  name?: string
  home_team?: string
  away_team?: string
  home_team_name?: string
  away_team_name?: string
  participants?: Array<{ name?: string; short_name?: string; home?: boolean; role?: string }>
  start_time?: string
  start_date?: string
  start_ts?: number
  markets?: Record<string, any> | any[]
  market_order?: number[]
  [key: string]: any
}

function extractTeams(e: SpectateEvent): { home: string; away: string } | null {
  if (e.home_team && e.away_team) return { home: String(e.home_team), away: String(e.away_team) }
  if (e.home_team_name && e.away_team_name) return { home: String(e.home_team_name), away: String(e.away_team_name) }
  if (Array.isArray(e.participants) && e.participants.length >= 2) {
    const h = e.participants.find(p => p.home === true || p.role === 'home')
    const a = e.participants.find(p => p !== h)
    if (h?.name && a?.name) return { home: h.name, away: a.name }
  }
  // Spectate event.name is "<away> @ <home>" (American convention).
  if (typeof e.name === 'string' && e.name.includes(' @ ')) {
    const [away, home] = e.name.split(' @ ').map(s => s.trim())
    if (away && home) return { home, away }
  }
  if (typeof e.name === 'string' && e.name.includes(' vs ')) {
    const [home, away] = e.name.split(' vs ').map(s => s.trim())
    if (home && away) return { home, away }
  }
  return null
}

function extractStart(e: SpectateEvent): string | null {
  // Spectate ships start_time as ISO with offset, e.g. "2026-04-22T02:30:00+00:00"
  if (typeof e.start_time === 'string' && e.start_time.length >= 10) return e.start_time
  if (typeof e.start_date === 'string' && e.start_date.length >= 10) return e.start_date
  if (typeof e.start_ts === 'number') return new Date(e.start_ts * 1000).toISOString()
  const alt = (e as any).event_start_time ?? (e as any).scheduled_start ?? (e as any).scheduled_date
  if (typeof alt === 'string') return alt
  return null
}

/** Pull game markets out of an event's markets object. Spectate ships either
 *  an object keyed by market_id or an array. Outcomes carry a name +
 *  decimal_odds + line. */
function extractGameMarkets(e: SpectateEvent, home: string, away: string): GameMarket[] {
  const markets = Array.isArray(e.markets)
    ? e.markets
    : e.markets && typeof e.markets === 'object' ? Object.values(e.markets) : []
  if (markets.length === 0) return []

  const byType: Record<'moneyline' | 'spread' | 'total', any[]> = { moneyline: [], spread: [], total: [] }
  for (const m of markets as any[]) {
    const label = String(m?.name ?? m?.market_name ?? m?.type ?? m?.display_name ?? '')
    const t = classifyMarket(label)
    if (!t) continue
    byType[t].push(m)
  }

  const out: GameMarket[] = []
  const outcomesOf = (m: any): any[] => {
    // Spectate: m.selections is an object keyed by selection_id.
    if (m?.selections && typeof m.selections === 'object' && !Array.isArray(m.selections)) {
      return Object.values(m.selections)
    }
    if (Array.isArray(m?.outcomes)) return m.outcomes
    if (Array.isArray(m?.selections)) return m.selections
    if (m?.outcomes && typeof m.outcomes === 'object') return Object.values(m.outcomes)
    return []
  }
  const nameOf = (o: any) => String(o?.name ?? o?.selection_name ?? o?.label ?? '').toLowerCase()
  const priceOf = (o: any) => toAmerican(o?.fraction_price ?? o?.decimal_price ?? o?.decimal_odds ?? o?.odds ?? o?.price ?? o?.value)
  const lineOf = (o: any): number | null => {
    for (const k of ['line', 'handicap', 'point', 'value', 'param', 'base']) {
      const v = o?.[k]
      if (typeof v === 'number' && isFinite(v)) return v
      if (typeof v === 'string') { const n = Number(v); if (!isNaN(n)) return n }
    }
    return null
  }

  // Moneyline
  if (byType.moneyline[0]) {
    const m = byType.moneyline[0]
    let hp: number | null = null, ap: number | null = null
    for (const o of outcomesOf(m)) {
      const n = nameOf(o), price = priceOf(o)
      if (price == null) continue
      if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n))) hp = price
      else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n))) ap = price
    }
    if (hp != null || ap != null) {
      out.push({
        marketType: 'moneyline',
        homePrice: hp, awayPrice: ap, drawPrice: null,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
      })
    }
  }

  // Spread
  {
    let best: { hp: number | null; ap: number | null; spread: number | null } | null = null
    let bestScore = Infinity
    for (const m of byType.spread) {
      let hp: number | null = null, ap: number | null = null, spread: number | null = null
      for (const o of outcomesOf(m)) {
        const n = nameOf(o), price = priceOf(o), line = lineOf(o)
        if (price == null) continue
        if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n))) {
          hp = price; if (spread == null && line != null) spread = line
        } else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n))) {
          ap = price; if (spread == null && line != null) spread = -line
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
      for (const o of outcomesOf(m)) {
        const n = nameOf(o), price = priceOf(o), line = lineOf(o)
        if (price == null) continue
        if (n.startsWith('over') || n === 'o') { op = price; if (total == null) total = line }
        else if (n.startsWith('under') || n === 'u') { up = price; if (total == null) total = line }
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

export const eightyEightSportAdapter: BookAdapter = {
  slug: '888sport',
  name: '888sport (Ontario)',
  pollIntervalSec: 300,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      log.info('888sport seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      } catch (e: any) {
        errors.push(`seed: ${e?.message ?? e}`)
        log.error('888sport seed failed', { message: e?.message ?? String(e) })
        return { events: scraped, errors }
      }
      // Let Spectate's SPA mint its session cookies. First-cycle after a
      // fresh context was returning HTTP 400 on league fetches when we
      // only waited 5s; 10s eliminates the race.
      await page.waitForTimeout(10_000)

      const pageFetch = async (url: string): Promise<{ status: number; text: string }> => {
        return page.evaluate(async (u: string) => {
          try {
            const r = await fetch(u, { headers: { Accept: 'application/json' }, credentials: 'include' })
            return { status: r.status, text: await r.text() }
          } catch (e: any) {
            return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
          }
        }, url)
      }

      // Markets are inlined under events[id].markets[market_id] — confirmed
      // from round-4 raw dump. No separate getMarkets call needed.
      let loggedSample = false
      let rawSampleLogged = false
      for (const L of LEAGUES) {
        if (signal.aborted) break
        const url = `${API_HOST}/spectate/sportsbook-req/getTournamentMatches/${L.sport}/${L.country}/${L.league}`
        const { status, text } = await pageFetch(url)
        if (status !== 200) {
          errors.push(`${L.leagueSlug} getTournamentMatches HTTP ${status}`)
          log.warn('888sport list non-200', { league: L.leagueSlug, status })
          continue
        }
        let json: any
        try { json = JSON.parse(text) } catch {
          errors.push(`${L.leagueSlug} getTournamentMatches non-JSON`)
          continue
        }
        const eventsObj: Record<string, SpectateEvent> = json?.events ?? {}
        // event_order is an array of { event_id, grouped_market_ids, market_id }
        // objects — not bare ids. Extract event_id from each and dedupe.
        const rawOrder: any[] = Array.isArray(json?.event_order) ? json.event_order : []
        const seenIds = new Set<number>()
        const order: number[] = []
        for (const entry of rawOrder) {
          const eid = typeof entry === 'object' && entry !== null ? entry.event_id : Number(entry)
          if (typeof eid === 'number' && isFinite(eid) && !seenIds.has(eid)) {
            seenIds.add(eid)
            order.push(eid)
          }
        }
        if (order.length === 0) {
          for (const k of Object.keys(eventsObj)) {
            const n = Number(k)
            if (isFinite(n)) order.push(n)
          }
        }
        const pointers: Array<{ event_id: number; market_id: number }> = Array.isArray(json?.selection_pointers) ? json.selection_pointers : []
        log.info('888sport league events', { league: L.leagueSlug, count: order.length, pointers: pointers.length })

        // One-time raw dump — we cannot yet see the actual event/market shape
        // because previous discovery captures got truncated. Log the first
        // event body + the full list-response top-level keys so we can iterate.
        if (!rawSampleLogged && order.length > 0) {
          rawSampleLogged = true
          const firstEid = order[0]
          const firstEv = eventsObj[String(firstEid)] ?? eventsObj[firstEid as any]
          log.info('888sport raw sample', {
            listTopKeys: Object.keys(json).slice(0, 20),
            eventsShape: Array.isArray(eventsObj) ? 'array' : typeof eventsObj,
            eventsKeys: (eventsObj && typeof eventsObj === 'object')
              ? Object.keys(eventsObj).slice(0, 5) : null,
            pointerSample: pointers.slice(0, 3),
            firstEventId: firstEid,
            eventKeys: firstEv ? Object.keys(firstEv) : null,
            eventBody: firstEv ? JSON.stringify(firstEv).slice(0, 2000) : '<firstEv undefined>',
            // Dump the response shape when the events lookup fails so we can
            // see where Spectate actually nested them.
            listSample: firstEv ? null : JSON.stringify(json).slice(0, 2000),
          })
        }

        for (const eid of order) {
          const ev = eventsObj[String(eid)] ?? eventsObj[eid as any]
          if (!ev) continue
          const teams = extractTeams(ev)
          const start = extractStart(ev)
          if (!teams || !start) continue

          if (!loggedSample) {
            loggedSample = true
            log.info('888sport sample event', {
              id: ev.id ?? eid,
              keys: Object.keys(ev).slice(0, 30),
              marketShape: ev.markets
                ? (Array.isArray(ev.markets)
                    ? { type: 'array', len: ev.markets.length, firstKeys: ev.markets[0] ? Object.keys(ev.markets[0]).slice(0, 20) : [] }
                    : { type: 'object', len: Object.keys(ev.markets).length })
                : null,
            })
          }

          const event: NormalizedEvent = {
            externalId: String(ev.id ?? eid),
            homeTeam: teams.home,
            awayTeam: teams.away,
            startTime: start,
            leagueSlug: L.leagueSlug,
            sport: L.sportCanonical,
          }
          const gameMarkets = extractGameMarkets(ev, teams.home, teams.away)
          scraped.push({ event, gameMarkets, props: [] })
        }
      }

      log.info('888sport scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
