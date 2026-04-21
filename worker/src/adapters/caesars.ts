/**
 * Caesars (Ontario) adapter — Playwright edition.
 *
 * Endpoint family (Liberty/SGP platform):
 *   Base: https://api.americanwagering.com/regions/ca/locations/on/brands/czr/sb/v4
 *   Home:                /home                           (navigation / competition UUIDs)
 *   Competition events:  /sports/{sport}/competitions/{compUuid}/events
 *                        (captured at runtime from page's own XHRs)
 *   Single event:        /events/{eventUuid}?useEventPayloadWithTabNav=true
 *
 * AWS WAF fronts the API. Tokens (x-aws-waf-token) are session-bound and
 * issued after a JS challenge. Playwright solves this transparently, and we
 * reuse the page's session by calling fetch() inside page.evaluate — cookies +
 * token are inherited automatically.
 *
 * Strategy per competition:
 *   1. Navigate to sportsbook.caesars.com league page (AWS WAF solved in-browser).
 *   2. Listen for XHRs — capture the event-list URL that the page fires.
 *   3. Parse the event list → get event UUIDs + team names + start times.
 *   4. For each event, call /events/{id}?useEventPayloadWithTabNav=true from
 *      inside the page context to inherit cookies/WAF token.
 *   5. Normalize: moneyline / spread / total (game lines only for v1).
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, ScrapedEvent, GameMarket } from '../lib/types.js'

const SEED_ROOT = 'https://sportsbook.caesars.com/ca/on/bet'
const API_BASE = 'https://api.americanwagering.com/regions/ca/locations/on/brands/czr/sb/v4'

interface Competition {
  name: string
  leagueSlug: string
  sport: string           // canonical sport used by normalize
  sportApi: string        // 'basketball' / 'baseball' / 'ice-hockey' (Caesars slug)
  pagePath: string        // path under sportsbook.caesars.com/ca/on/bet
}

// NBA competition UUID captured from DevTools: 5806c896-4eec-4de1-874f-afed93114b8c.
// The adapter auto-discovers the competition event-list URL via XHR capture, so we
// don't need to hardcode UUIDs for each league — just navigate to the right page.
const COMPETITIONS: Competition[] = [
  { name: 'NBA', leagueSlug: 'nba', sport: 'basketball',
    sportApi: 'basketball', pagePath: '/basketball/competitions/nba' },
  { name: 'MLB', leagueSlug: 'mlb', sport: 'baseball',
    sportApi: 'baseball',   pagePath: '/baseball/competitions/mlb' },
  { name: 'NHL', leagueSlug: 'nhl', sport: 'ice_hockey',
    sportApi: 'ice-hockey', pagePath: '/ice-hockey/competitions/nhl' },
]

/** Price object shapes Caesars has used: { a: "-110" }, { american: -110 },
 *  or a nested selection.price.d (decimal). Try them all. */
function extractAmerican(price: any): number | null {
  if (price == null) return null
  if (typeof price === 'number') return Math.round(price)
  if (typeof price === 'string') {
    const n = parseInt(price, 10)
    return isNaN(n) ? null : n
  }
  if (typeof price === 'object') {
    // Prefer american; then decimal→american; then fractional→american.
    if (price.a != null) return extractAmerican(price.a)
    if (price.american != null) return extractAmerican(price.american)
    if (price.americanPrice != null) return extractAmerican(price.americanPrice)
    if (typeof price.d === 'number' && price.d > 1) return decimalToAmerican(price.d)
    if (typeof price.decimal === 'number' && price.decimal > 1) return decimalToAmerican(price.decimal)
    if (typeof price.f === 'string') return fractionalToAmerican(price.f)
    if (typeof price.fractional === 'string') return fractionalToAmerican(price.fractional)
  }
  return null
}

function decimalToAmerican(d: number): number | null {
  if (!isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

function fractionalToAmerican(frac: string): number | null {
  const slash = frac.indexOf('/')
  if (slash === -1) return null
  const num = Number(frac.slice(0, slash))
  const den = Number(frac.slice(slash + 1))
  if (!isFinite(num) || !isFinite(den) || den === 0) return null
  const f = num / den
  return f >= 1 ? Math.round(f * 100) : Math.round(-(den / num) * 100)
}

/** Given a Caesars market template/type name, classify to our canonical
 *  market type. Caesars names vary: "Moneyline", "Money Line", "Spread",
 *  "Point Spread", "Run Line", "Puck Line", "Total", "Total Points",
 *  "Total Runs", "Over/Under Goals", etc. */
function classifyMarket(m: any): 'moneyline' | 'spread' | 'total' | null {
  const candidates: string[] = []
  if (m?.displayName) candidates.push(String(m.displayName))
  if (m?.name) candidates.push(String(m.name))
  if (m?.templateName) candidates.push(String(m.templateName))
  if (m?.template?.name) candidates.push(String(m.template.name))
  if (m?.type?.name) candidates.push(String(m.type.name))
  if (m?.type) candidates.push(String(m.type))
  const name = candidates.join(' ').toLowerCase()
  if (!name) return null

  // Exclude alt/props/period/quarter/half markets — only main lines.
  if (/\b(1st|2nd|3rd|4th|first|second|third|fourth|half|quarter|inning|period|race to|to score|alt)\b/.test(name)) return null

  if (/money\s*line|moneyline|match\s*winner|to\s*win/.test(name)) return 'moneyline'
  if (/run\s*line|puck\s*line|point\s*spread|\bspread\b|handicap/.test(name)) return 'spread'
  if (/\btotal\b|over\/?under|over\s*\/\s*under|totals/.test(name)) return 'total'
  return null
}

/** Caesars "main line" heuristic: prefer markets flagged as main/default,
 *  otherwise the market whose name has no qualifier ("Spread" not "Spread -3"). */
function isMainLine(m: any): boolean {
  if (m?.isMainMarket === true) return true
  if (m?.isMain === true) return true
  if (m?.main === true) return true
  // Caesars sometimes tags alt lines with "alternate" in templateName.
  const name = String(m?.displayName ?? m?.name ?? '').toLowerCase()
  return !/alt|alternate/.test(name)
}

interface CaesarsEvent {
  id: string
  name: string
  startTime: string
  competitors: Array<{ id?: string; name: string; home: boolean }>
}

/** Pull events out of a competition-events response. Tries several shape
 *  variants since Liberty has slight per-endpoint differences. */
function extractEventsFromList(body: any): CaesarsEvent[] {
  const out: CaesarsEvent[] = []
  const maybeLists: any[] = []
  if (Array.isArray(body)) maybeLists.push(body)
  if (Array.isArray(body?.events)) maybeLists.push(body.events)
  if (Array.isArray(body?.items)) maybeLists.push(body.items)
  if (Array.isArray(body?.competitions)) {
    for (const c of body.competitions) {
      if (Array.isArray(c.events)) maybeLists.push(c.events)
    }
  }
  for (const list of maybeLists) {
    for (const e of list) {
      const id = e?.id ?? e?.eventId
      const startTime = e?.startTime ?? e?.scheduledStartTime ?? e?.eventDate
      const name = e?.name ?? e?.eventName ?? ''
      if (!id || !startTime) continue

      const participants = e?.competitors ?? e?.participants ?? e?.teams ?? []
      const competitors: CaesarsEvent['competitors'] = []
      for (const p of participants) {
        const pName = p?.name ?? p?.teamName ?? p?.shortName
        if (!pName) continue
        competitors.push({
          id: p?.id,
          name: String(pName),
          home: p?.home === true || p?.isHome === true || p?.side === 'home' || p?.role === 'home',
        })
      }
      if (competitors.length < 2) continue
      out.push({ id: String(id), name: String(name), startTime: String(startTime), competitors })
    }
  }
  return out
}

/** Walk a single-event payload and return game markets we recognize. */
function extractGameMarketsFromEvent(
  body: any,
  homeName: string,
  awayName: string,
): GameMarket[] {
  const markets: any[] = []
  // Markets can live in various places depending on useEventPayloadWithTabNav.
  const push = (arr: any) => { if (Array.isArray(arr)) markets.push(...arr) }
  push(body?.markets)
  push(body?.event?.markets)
  if (Array.isArray(body?.tabs)) {
    for (const tab of body.tabs) {
      push(tab?.markets)
      if (Array.isArray(tab?.sections)) {
        for (const sec of tab.sections) push(sec?.markets)
      }
    }
  }

  // Group by classification, then pick main line.
  const byType: Record<'moneyline' | 'spread' | 'total', any[]> = {
    moneyline: [], spread: [], total: [],
  }
  for (const m of markets) {
    const t = classifyMarket(m)
    if (!t) continue
    byType[t].push(m)
  }

  const out: GameMarket[] = []

  // --- Moneyline ---
  {
    const m = byType.moneyline.find(isMainLine) ?? byType.moneyline[0]
    if (m) {
      let homePrice: number | null = null
      let awayPrice: number | null = null
      let drawPrice: number | null = null
      const selections: any[] = m.selections ?? m.outcomes ?? []
      for (const s of selections) {
        const sName = String(s?.name ?? '').toLowerCase()
        const price = extractAmerican(s?.price ?? s)
        if (price == null) continue
        if (sName === 'draw' || sName === 'tie') drawPrice = price
        else if (sName && homeName.toLowerCase().includes(sName)) homePrice = price
        else if (sName && awayName.toLowerCase().includes(sName)) awayPrice = price
        else if (sName && sName.includes(homeName.toLowerCase())) homePrice = price
        else if (sName && sName.includes(awayName.toLowerCase())) awayPrice = price
      }
      if (homePrice != null || awayPrice != null || drawPrice != null) {
        out.push({
          marketType: 'moneyline',
          homePrice, awayPrice, drawPrice,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      }
    }
  }

  // --- Spread (pick the main line by balanced prices near -110) ---
  {
    const mains = byType.spread.filter(isMainLine)
    const pool = mains.length ? mains : byType.spread
    // Prefer the market whose home-side price is closest to -110 (main line).
    let best: { homePrice: number | null; awayPrice: number | null; spread: number | null } | null = null
    let bestScore = Infinity
    for (const m of pool) {
      const selections: any[] = m.selections ?? m.outcomes ?? []
      let hp: number | null = null, ap: number | null = null, hs: number | null = null
      for (const s of selections) {
        const sName = String(s?.name ?? '').toLowerCase()
        const price = extractAmerican(s?.price ?? s)
        const line = typeof s?.line === 'number' ? s.line
          : typeof s?.handicap === 'number' ? s.handicap
          : typeof s?.points === 'number' ? s.points
          : null
        if (price == null) continue
        if (homeName && (sName.includes(homeName.toLowerCase()) || homeName.toLowerCase().includes(sName))) {
          hp = price; if (hs == null && line != null) hs = line
        } else if (awayName && (sName.includes(awayName.toLowerCase()) || awayName.toLowerCase().includes(sName))) {
          ap = price; if (hs == null && line != null) hs = -line
        }
      }
      if (hp == null && ap == null) continue
      const score = Math.abs((hp ?? -110) + 110) + Math.abs((ap ?? -110) + 110)
      if (score < bestScore) {
        bestScore = score
        best = { homePrice: hp, awayPrice: ap, spread: hs }
      }
    }
    if (best && (best.homePrice != null || best.awayPrice != null)) {
      out.push({
        marketType: 'spread',
        homePrice: best.homePrice, awayPrice: best.awayPrice, drawPrice: null,
        spreadValue: best.spread,
        totalValue: null, overPrice: null, underPrice: null,
      })
    }
  }

  // --- Total ---
  {
    const mains = byType.total.filter(isMainLine)
    const pool = mains.length ? mains : byType.total
    let best: { overPrice: number | null; underPrice: number | null; total: number | null } | null = null
    let bestScore = Infinity
    for (const m of pool) {
      const selections: any[] = m.selections ?? m.outcomes ?? []
      let op: number | null = null, up: number | null = null, total: number | null = null
      for (const s of selections) {
        const sName = String(s?.name ?? '').toLowerCase()
        const price = extractAmerican(s?.price ?? s)
        const line = typeof s?.line === 'number' ? s.line
          : typeof s?.handicap === 'number' ? s.handicap
          : typeof s?.points === 'number' ? s.points
          : null
        if (price == null) continue
        if (sName.startsWith('over') || sName === 'o') { op = price; if (total == null) total = line }
        else if (sName.startsWith('under') || sName === 'u') { up = price; if (total == null) total = line }
      }
      if (op == null && up == null) continue
      const score = Math.abs((op ?? -110) + 110) + Math.abs((up ?? -110) + 110)
      if (score < bestScore) {
        bestScore = score
        best = { overPrice: op, underPrice: up, total }
      }
    }
    if (best && (best.overPrice != null || best.underPrice != null)) {
      out.push({
        marketType: 'total',
        homePrice: null, awayPrice: null, drawPrice: null,
        spreadValue: null,
        totalValue: best.total,
        overPrice: best.overPrice, underPrice: best.underPrice,
      })
    }
  }

  return out
}

export const caesarsAdapter: BookAdapter = {
  slug: 'caesars',
  name: 'Caesars (Ontario)',
  pollIntervalSec: 180,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      for (const comp of COMPETITIONS) {
        if (signal.aborted) break

        // Capture XHRs to api.americanwagering.com during league-page load —
        // this gives us the event-list endpoint (URL differs per sport) and
        // possibly the first few event bodies for free.
        const capturedEventLists: string[] = []
        const bodyByUrl = new Map<string, string>()
        const allApiUrls: string[] = []

        const responseHandler = async (resp: import('playwright').Response) => {
          const url = resp.url()
          if (!url.includes('api.americanwagering.com')) return
          allApiUrls.push(`${resp.status()} ${url.length > 200 ? url.slice(0, 200) + '...' : url}`)
          // Candidate event-list URLs: contain /events or /competitions/.../events.
          if (/\/sports\/[^/]+\/competitions\/[^/]+\/events/.test(url) ||
              /\/events\/schedule\b/.test(url) ||
              /\/competitions\/[^/]+\/events\b/.test(url)) {
            capturedEventLists.push(url)
            try { bodyByUrl.set(url, await resp.text()) } catch { /* stream may be closed */ }
          }
          // Also capture any single-event responses the page grabs (home page
          // sometimes prefetches a few).
          if (/\/events\/[0-9a-f-]{36}\b/.test(url) && resp.status() < 400) {
            try { bodyByUrl.set(url, await resp.text()) } catch { /* ignore */ }
          }
        }
        page.on('response', responseHandler)

        const targetUrl = SEED_ROOT + comp.pagePath
        log.info('navigating to comp page', { comp: comp.name, url: targetUrl })
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        } catch (e: any) {
          log.error('comp page nav failed', { comp: comp.name, message: e?.message ?? String(e) })
          errors.push(`${comp.name} nav: ${e?.message ?? e}`)
          page.off('response', responseHandler)
          continue
        }
        // Let the SPA fire its XHRs. Caesars typically settles within 5-10s.
        await page.waitForTimeout(10_000)
        page.off('response', responseHandler)

        log.info('caesars xhrs captured', {
          comp: comp.name,
          totalApi: allApiUrls.length,
          eventLists: capturedEventLists.length,
          sample: allApiUrls.slice(0, 20),
        })

        // Parse events from captured lists. If nothing captured, skip comp.
        const events: CaesarsEvent[] = []
        const seenEventIds = new Set<string>()
        for (const url of capturedEventLists) {
          const text = bodyByUrl.get(url)
          if (!text) continue
          let body: any
          try { body = JSON.parse(text) } catch { continue }
          const parsed = extractEventsFromList(body)
          for (const e of parsed) {
            if (seenEventIds.has(e.id)) continue
            seenEventIds.add(e.id)
            events.push(e)
          }
        }

        if (events.length === 0) {
          log.warn('no events — skipping comp', {
            comp: comp.name,
            capturedListUrls: capturedEventLists.slice(0, 5),
          })
          continue
        }
        log.info('events discovered', { comp: comp.name, count: events.length })

        // For each event, fetch single-event markets via page.evaluate so the
        // WAF token + cookies are inherited. Parallel but bounded.
        const CONCURRENCY = 6
        let cursor = 0
        async function worker() {
          while (cursor < events.length) {
            if (signal.aborted) return
            const idx = cursor++
            const ev = events[idx]
            const eventUrl = `${API_BASE}/events/${ev.id}?useEventPayloadWithTabNav=true`
            try {
              const resp = await page.evaluate(async (u) => {
                const r = await fetch(u, { credentials: 'include', headers: { accept: 'application/json' } })
                const t = await r.text()
                return { status: r.status, text: t }
              }, eventUrl)
              if (resp.status >= 400) {
                errors.push(`${comp.name} event ${ev.id}: HTTP ${resp.status}`)
                continue
              }
              let body: any
              try { body = JSON.parse(resp.text) } catch {
                errors.push(`${comp.name} event ${ev.id}: non-JSON body`)
                continue
              }
              const home = ev.competitors.find(c => c.home) ?? ev.competitors[0]
              const away = ev.competitors.find(c => !c.home) ?? ev.competitors[1]
              const gameMarkets = extractGameMarketsFromEvent(body, home.name, away.name)
              scraped.push({
                event: {
                  externalId: ev.id,
                  homeTeam: home.name,
                  awayTeam: away.name,
                  startTime: ev.startTime,
                  leagueSlug: comp.leagueSlug,
                  sport: comp.sport,
                },
                gameMarkets,
                props: [],
              })
            } catch (e: any) {
              errors.push(`${comp.name} event ${ev.id}: ${e?.message ?? e}`)
            }
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      }

      return { events: scraped, errors }
    })
  },
}
