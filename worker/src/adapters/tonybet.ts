/**
 * TonyBet (Ontario) — real adapter.
 *
 * Endpoint (confirmed via discovery):
 *   GET https://platform.tonybet.com/api/event/list
 *        ?lang=en
 *        &relations[]=odds
 *        &relations[]=competitors
 *        &relations[]=league
 *        &relations[]=sportCategories
 *   Response: { status: "ok", data: { items: [ {...event} ] } }
 *
 * Strategy: navigate the CA sportsbook to each major sport, passively
 * capture /api/event/list responses the SPA fires with full bodies (we bump
 * the capture window far above the normal discovery snippet size), then
 * parse the items[] array with permissive shape extraction. On the first
 * run per deploy we log one full item so we can iterate on the schema.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedEvent } from '../lib/types.js'

const SEED_URL = 'https://tonybet.com/en-ca/sport'

const SPORT_PATHS: Array<{ path: string; leagueSlug: string; sport: string; leagueNameRe: RegExp }> = [
  { path: 'basketball', leagueSlug: 'nba', sport: 'basketball', leagueNameRe: /\bnba\b/i },
  { path: 'baseball',   leagueSlug: 'mlb', sport: 'baseball',   leagueNameRe: /\bmlb\b/i },
  { path: 'ice-hockey', leagueSlug: 'nhl', sport: 'ice_hockey', leagueNameRe: /\bnhl\b/i },
]

/** Try the common American / decimal / fractional shapes the BetConstruct
 *  stack uses. Returns null if nothing parses. */
function toAmerican(price: any): number | null {
  if (price == null) return null
  if (typeof price === 'number') {
    // BetConstruct stores decimal odds as numbers like 1.91.
    if (price >= 1.01 && price <= 50) {
      if (price >= 2) return Math.round((price - 1) * 100)
      return Math.round(-100 / (price - 1))
    }
    // Sometimes already american.
    if (price >= 100 || price <= -100) return Math.round(price)
    return null
  }
  if (typeof price === 'string') {
    const n = Number(price)
    if (!isNaN(n)) return toAmerican(n)
  }
  if (typeof price === 'object') {
    if (price.american != null) return toAmerican(price.american)
    if (price.odds != null) return toAmerican(price.odds)
    if (price.price != null) return toAmerican(price.price)
    if (price.value != null) return toAmerican(price.value)
    if (price.coefficient != null) return toAmerican(price.coefficient)
  }
  return null
}

/** Classify a market/odd group name to our canonical market type. */
function classifyMarket(name: string): 'moneyline' | 'spread' | 'total' | null {
  const n = name.toLowerCase()
  // Guard against period/half/quarter/prop markets.
  if (/\b(1st|2nd|3rd|4th|first|second|third|fourth|half|quarter|inning|period|race to|to score|alt)\b/.test(n)) return null
  if (/money\s*line|moneyline|match\s*winner|1x2|to\s*win/.test(n)) return 'moneyline'
  if (/run\s*line|puck\s*line|point\s*spread|\bspread\b|handicap/.test(n)) return 'spread'
  if (/\btotal\b|over\/?under|over\s*\/\s*under|totals/.test(n)) return 'total'
  return null
}

interface TonyBetEvent {
  id: number | string
  team1?: { name?: string } | string
  team2?: { name?: string } | string
  homeTeam?: string
  awayTeam?: string
  competitors?: Array<{ name?: string; home?: boolean; isHome?: boolean; role?: string; side?: string }>
  startTs?: number | string
  startDate?: string
  startTime?: string
  league?: { name?: string } | string
  leagueName?: string
  odds?: any[]
  markets?: any[]
}

/** Pull team names from the various shapes BetConstruct sites use. */
function extractTeams(e: TonyBetEvent): { home: string; away: string } | null {
  const get = (x: any): string => {
    if (!x) return ''
    if (typeof x === 'string') return x
    if (typeof x === 'object') return String(x.name ?? x.teamName ?? x.shortName ?? '')
    return ''
  }
  // team1 / team2
  const t1 = get((e as any).team1), t2 = get((e as any).team2)
  if (t1 && t2) return { home: t1, away: t2 }
  // explicit home/away
  if (e.homeTeam && e.awayTeam) return { home: e.homeTeam, away: e.awayTeam }
  // competitors[]
  if (Array.isArray(e.competitors) && e.competitors.length >= 2) {
    const homeC = e.competitors.find(c => c.home === true || c.isHome === true || c.role === 'home' || c.side === 'home')
    const awayC = e.competitors.find(c => c !== homeC)
    const home = get(homeC ?? e.competitors[0])
    const away = get(awayC ?? e.competitors[1])
    if (home && away) return { home, away }
  }
  return null
}

function extractStartIso(e: TonyBetEvent): string | null {
  if (typeof e.startDate === 'string' && e.startDate.length >= 10) return e.startDate
  if (typeof e.startTime === 'string' && e.startTime.length >= 10) return e.startTime
  if (typeof e.startTs === 'number') return new Date(e.startTs * 1000).toISOString()
  if (typeof e.startTs === 'string') {
    const n = Number(e.startTs)
    if (!isNaN(n)) return new Date(n * 1000).toISOString()
  }
  const ts = (e as any).startTimestamp
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString()
  return null
}

function extractLeagueName(e: TonyBetEvent): string {
  if (typeof e.league === 'string') return e.league
  if (e.league && typeof e.league === 'object') return String(e.league.name ?? '')
  return String(e.leagueName ?? '')
}

/** Walk an event's odds/markets collection and emit game markets we recognize. */
function extractGameMarkets(e: TonyBetEvent, home: string, away: string): GameMarket[] {
  const groups = (Array.isArray(e.odds) ? e.odds : []).concat(Array.isArray(e.markets) ? e.markets : [])
  if (groups.length === 0) return []

  // Each "group" is a market: has name + outcomes[] (or odds[]).
  const byType: Record<'moneyline' | 'spread' | 'total', any[]> = { moneyline: [], spread: [], total: [] }
  for (const g of groups) {
    const name = String(g?.name ?? g?.marketName ?? g?.title ?? g?.m ?? '')
    const t = classifyMarket(name)
    if (!t) continue
    byType[t].push(g)
  }

  const out: GameMarket[] = []
  const outcomesOf = (g: any): any[] =>
    Array.isArray(g?.outcomes) ? g.outcomes
    : Array.isArray(g?.odds) ? g.odds
    : Array.isArray(g?.selections) ? g.selections
    : []

  const lineOf = (o: any): number | null => {
    for (const k of ['base', 'line', 'handicap', 'point', 'value', 'param']) {
      const v = o?.[k]
      if (typeof v === 'number' && isFinite(v)) return v
      if (typeof v === 'string') { const n = Number(v); if (!isNaN(n)) return n }
    }
    return null
  }

  const nameOf = (o: any): string => String(o?.name ?? o?.outcomeName ?? o?.label ?? o?.type ?? '').toLowerCase()

  // Moneyline
  {
    const ml = byType.moneyline[0]
    if (ml) {
      let hp: number | null = null, ap: number | null = null, dp: number | null = null
      for (const o of outcomesOf(ml)) {
        const n = nameOf(o)
        const price = toAmerican(o?.price ?? o)
        if (price == null) continue
        if (n === 'draw' || n === 'tie' || n === 'x') dp = price
        else if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n))) hp = price
        else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n))) ap = price
        else if (n === '1') hp = price
        else if (n === '2') ap = price
      }
      if (hp != null || ap != null || dp != null) {
        out.push({
          marketType: 'moneyline',
          homePrice: hp, awayPrice: ap, drawPrice: dp,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      }
    }
  }

  // Spread — pick the group whose outcome prices are closest to -110.
  {
    let best: { hp: number | null; ap: number | null; spread: number | null } | null = null
    let bestScore = Infinity
    for (const g of byType.spread) {
      let hp: number | null = null, ap: number | null = null, spread: number | null = null
      for (const o of outcomesOf(g)) {
        const n = nameOf(o)
        const price = toAmerican(o?.price ?? o)
        const line = lineOf(o)
        if (price == null) continue
        if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n) || n === '1')) {
          hp = price; if (spread == null && line != null) spread = line
        } else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n) || n === '2')) {
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
    for (const g of byType.total) {
      let op: number | null = null, up: number | null = null, total: number | null = null
      for (const o of outcomesOf(g)) {
        const n = nameOf(o)
        const price = toAmerican(o?.price ?? o)
        const line = lineOf(o)
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
        totalValue: best.total,
        overPrice: best.op, underPrice: best.up,
      })
    }
  }

  return out
}

export const tonybetAdapter: BookAdapter = {
  slug: 'tonybet',
  name: 'TonyBet (Ontario)',
  pollIntervalSec: 300,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      // Passive capture of /api/event/list responses as the SPA fetches them.
      // Also record every unique JSON host we see for diagnostics — lets us
      // tell in one log line whether the SPA ever called our expected endpoint.
      const listBodies: string[] = []
      const seenJsonHosts = new Map<string, number>()
      const responseHandler = async (resp: import('playwright').Response) => {
        const u = resp.url()
        const ct = (resp.headers()['content-type'] ?? '').toLowerCase()
        if (ct.includes('json')) {
          try {
            const host = new URL(u).host
            seenJsonHosts.set(host, (seenJsonHosts.get(host) ?? 0) + 1)
          } catch { /* ignore */ }
        }
        // Broadened: any event-list-shaped path on any tonybet host qualifies.
        // Earlier versions hardcoded platform.tonybet.com; the CA product may
        // serve from a different subdomain under the same path convention.
        if (!/tonybet\.[a-z]+\/api\/(event|events?)\/list/i.test(u)) return
        if (resp.status() !== 200) return
        try { listBodies.push(await resp.text()) } catch { /* stream closed */ }
      }
      page.on('response', responseHandler)

      log.info('tonybet seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('tonybet nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        page.off('response', responseHandler)
        return { events: scraped, errors }
      }
      await page.waitForTimeout(15_000)

      // Drive the SPA to each sport page — this is what causes event/list to fire.
      for (const s of SPORT_PATHS) {
        if (signal.aborted) break
        try {
          await page.goto(`https://tonybet.com/en-ca/sport/${s.path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(7_000)
        } catch (e: any) {
          log.warn('sport page nav failed', { path: s.path, message: e?.message ?? String(e) })
        }
      }
      page.off('response', responseHandler)
      log.info('tonybet captured', {
        listResponses: listBodies.length,
        jsonHostsSeen: Array.from(seenJsonHosts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15),
      })

      // Parse all captured bodies, dedupe by event id, and attach a league.
      const seen = new Set<string>()
      let loggedSample = false
      for (const body of listBodies) {
        let json: any
        try { json = JSON.parse(body) } catch { continue }
        const items: TonyBetEvent[] = json?.data?.items ?? json?.items ?? []
        if (!Array.isArray(items)) continue

        for (const item of items) {
          const id = String(item.id ?? (item as any).sbEventId ?? '')
          if (!id || seen.has(id)) continue

          const leagueName = extractLeagueName(item)
          const sportMatch = SPORT_PATHS.find(s => s.leagueNameRe.test(leagueName))
          if (!sportMatch) continue   // only keep NBA/MLB/NHL for v1

          const teams = extractTeams(item)
          const startIso = extractStartIso(item)
          if (!teams || !startIso) continue

          // First item we process this run: dump it so we can iterate.
          if (!loggedSample) {
            loggedSample = true
            log.info('tonybet sample item', {
              id, leagueName, teams, startIso,
              keys: Object.keys(item).slice(0, 30),
              oddsShape: Array.isArray(item.odds)
                ? { len: item.odds.length, firstKeys: item.odds[0] ? Object.keys(item.odds[0]).slice(0, 20) : [] }
                : null,
            })
          }

          seen.add(id)
          const gameMarkets = extractGameMarkets(item, teams.home, teams.away)
          const event: NormalizedEvent = {
            externalId: id,
            homeTeam: teams.home,
            awayTeam: teams.away,
            startTime: startIso,
            leagueSlug: sportMatch.leagueSlug,
            sport: sportMatch.sport,
          }
          scraped.push({ event, gameMarkets, props: [] })
        }
      }

      log.info('tonybet scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
