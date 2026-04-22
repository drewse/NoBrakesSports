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
import type { ScrapeResult, GameMarket } from '../lib/types.js'

// Caesars dropped the /ca/on/bet/ path prefix — front-end now lives at
// sportsbook.caesars.com/<sport>?id=<competitionUuid>.
const SEED_ROOT = 'https://sportsbook.caesars.com/basketball?id=5806c896-4eec-4de1-874f-afed93114b8c'
const API_HOST = 'https://api.americanwagering.com'
const API_BASE = `${API_HOST}/regions/ca/locations/on/brands/czr/sb/v4`
const SPORTS_MENU_URL = `${API_HOST}/regions/ca/locations/on/brands/czr/sb/v3/sports-menu`
// Response-listener host filter — matches legacy api.americanwagering.com AND
// any future caesars-branded API host. Paths are what actually identify the
// relevant XHRs; the host check is just a cheap pre-filter.
const CAESARS_API_HOST_RE = /americanwagering\.com|api\.[^/]*caesars/i

// Fixed SPA headers the Caesars sportsbook sends on every api.* call.
// Without these (captured from DevTools cURL), AWS WAF 403s even with a
// valid x-aws-waf-token.
const CAESARS_API_HEADERS: Record<string, string> = {
  'x-app-version': '7.45.1',
  'x-platform': 'cordova-desktop',
  'x-unique-device-id': '64a867de-e9ac-4aae-bae8-2901badfd8d2',
}

// League landing pages: navigating here causes the SPA to fire the
// events-list XHR (which AWS WAF blocks when we call it ourselves). By
// letting the SPA fire it and capturing the response body, we bypass the
// token issue entirely.
//
// NBA UUID captured 2026-04 from live site. MLB/NHL UUIDs unknown under the
// new URL scheme — landing on the bare sport path lets the SPA pick the
// default competition and fire its own XHRs, which we still capture.
const LEAGUE_URLS: Record<string, string> = {
  NBA: 'https://sportsbook.caesars.com/basketball?id=5806c896-4eec-4de1-874f-afed93114b8c',
  MLB: 'https://sportsbook.caesars.com/baseball',
  NHL: 'https://sportsbook.caesars.com/hockey',
}

interface Competition {
  name: string
  leagueSlug: string
  sport: string           // canonical sport used by normalize
  sportApi: string        // 'basketball' / 'baseball' / 'ice-hockey' (Caesars slug)
  menuName: string        // league name as it appears in sports-menu (for UUID lookup)
}

const COMPETITIONS: Competition[] = [
  { name: 'NBA', leagueSlug: 'nba', sport: 'basketball',
    sportApi: 'basketball', menuName: 'NBA' },
  { name: 'MLB', leagueSlug: 'mlb', sport: 'baseball',
    sportApi: 'baseball',   menuName: 'MLB' },
  { name: 'NHL', leagueSlug: 'nhl', sport: 'ice_hockey',
    sportApi: 'ice-hockey', menuName: 'NHL' },
]

/** Walk the sports-menu JSON to find { sportSlug → { compName → compUuid } }.
 *  The menu is nested: sports[].competitions[] or categories[].competitions[],
 *  with each competition having { id, name, slug }. Shape varies, so walk generically. */
function extractCompUuids(menu: any): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    // A node that looks like a competition: has id + name, no "events".
    const id = node.id ?? node.uuid ?? node.competitionId
    const name = node.name ?? node.displayName
    if (id && name && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
      out.set(String(name).toUpperCase(), id)
      const slug = node.slug ?? node.urlSlug
      if (slug) out.set(String(slug).toUpperCase(), id)
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(menu)
  return out
}

/** Find the subtree for a given competition in the sports-menu so we can
 *  inspect what structure Caesars ships (events inline? only links?). */
function findCompSubtree(menu: any, compUuid: string): any | null {
  let found: any = null
  const walk = (node: any) => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    const id = node.id ?? node.uuid ?? node.competitionId
    if (id === compUuid) { found = node; return }
    for (const v of Object.values(node)) walk(v)
  }
  walk(menu)
  return found
}

/** Mine event-shaped objects (have id + competitors or participants + startTime)
 *  from the sports-menu body. Some Liberty/SGP deployments ship a flattened
 *  events array inside the menu — if so, we never need the events-list
 *  endpoint (which AWS WAF blocks for us). Filtered to a specific
 *  competition UUID if the node tree references it via a parent link. */
function extractEventsFromMenu(menu: any, compUuid: string): CaesarsEvent[] {
  const sub = findCompSubtree(menu, compUuid)
  const root = sub ?? menu
  const out: CaesarsEvent[] = []
  const seen = new Set<string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    const id = node.id ?? node.eventId
    const startTime = node.startTime ?? node.scheduledStartTime ?? node.eventDate
    const name = node.name ?? node.eventName
    const parts = node.competitors ?? node.participants ?? node.teams
    if (id && startTime && Array.isArray(parts) && parts.length >= 2 && !seen.has(String(id))) {
      const competitors: CaesarsEvent['competitors'] = []
      for (const p of parts) {
        const pName = p?.name ?? p?.teamName ?? p?.shortName
        if (!pName) continue
        competitors.push({
          id: p?.id,
          name: String(pName),
          home: p?.home === true || p?.isHome === true || p?.side === 'home' || p?.role === 'home',
        })
      }
      if (competitors.length >= 2 && typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)) {
        seen.add(id)
        out.push({ id, name: String(name ?? ''), startTime: String(startTime), competitors })
      }
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(root)
  return out
}

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

      // Capture everything the SPA's own network stack fetches from the
      // api.* host. AWS WAF refuses any call we originate (even when we
      // replay the token), so our only reliable source of events-list and
      // single-event bodies is to let the SPA fire them and snarf the
      // response bodies.
      let menuBodyText = null as string | null
      const eventsListBodies: string[] = []
      const eventBodies = new Map<string, string>()  // eventId → body
      const wafTokenCandidates = new Set<string>()
      // Diagnostic: count every Caesars-host JSON path we see, regardless
      // of whether it matches our menu/events regex. If the SPA fires no
      // sports-menu call at all, this tells us what it IS firing.
      const seenCaesarsPaths = new Map<string, number>()

      const menuUrlRe = /\/sb\/v\d+\/sports-menu(\?|$)/
      const eventsListRe = /\/competitions\/[0-9a-f-]{36}\/events(\?|$)/
      const eventRe = /\/events\/([0-9a-f-]{36})(\?|$)/

      page.on('request', (req) => {
        const u = req.url()
        if (!CAESARS_API_HOST_RE.test(u)) return
        const headers = req.headers()
        const t = headers['x-aws-waf-token'] ?? headers['X-Aws-Waf-Token']
        if (t) wafTokenCandidates.add(t)
      })
      const responseHandler = async (resp: import('playwright').Response) => {
        const u = resp.url()
        if (!CAESARS_API_HOST_RE.test(u)) return
        try {
          const p = new URL(u).pathname
            .replace(/\/[0-9a-f-]{36}/g, '/:uuid')
            .replace(/\/\d{3,}/g, '/:id')
          seenCaesarsPaths.set(p, (seenCaesarsPaths.get(p) ?? 0) + 1)
        } catch { /* ignore */ }
        if (resp.status() !== 200) return
        try {
          if (menuUrlRe.test(u) && !menuBodyText) {
            menuBodyText = await resp.text()
            return
          }
          if (eventsListRe.test(u)) {
            eventsListBodies.push(await resp.text())
            return
          }
          const m = u.match(eventRe)
          if (m && !eventBodies.has(m[1])) {
            eventBodies.set(m[1], await resp.text())
          }
        } catch { /* body stream closed */ }
      }
      page.on('response', responseHandler)

      log.info('seeding caesars session via homepage')
      try {
        await page.goto(SEED_ROOT, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      } catch (e: any) {
        log.error('homepage seed failed', { message: e?.message ?? String(e) })
        errors.push(`seed: ${e?.message ?? e}`)
        page.off('response', responseHandler)
        return { events: scraped, errors }
      }
      // Nudge the SPA: Caesars' app is lazy — until the user scrolls or
      // interacts, it can leave the sports-menu + events XHRs unfired.
      // Scroll the viewport and wait for the menu response (longer window
      // since direct Railway IP seems to take longer to warm than PacketStream).
      try { await page.mouse.wheel(0, 800) } catch { /* ignore */ }
      try {
        await page.waitForResponse(
          (r) => menuUrlRe.test(r.url()) && r.status() === 200,
          { timeout: 35_000 },
        )
      } catch { /* proceed without passive menu */ }

      const wafToken = [...wafTokenCandidates].pop() ?? null
      log.info('caesars session', {
        tokenCount: wafTokenCandidates.size,
        hasMenu: !!menuBodyText,
        menuLen: menuBodyText?.length ?? 0,
      })

      // Best-effort: replay the token for a few direct calls. We never depend
      // on this succeeding — the SPA-driven passive capture is the fallback.
      const authedFetch = async (url: string): Promise<{ status: number; text: string }> => {
        return page.evaluate(async ({ u, token, extra }) => {
          try {
            const headers: Record<string, string> = { ...extra }
            if (token) headers['x-aws-waf-token'] = token
            const r = await fetch(u, { headers })
            return { status: r.status, text: await r.text() }
          } catch (e: any) {
            return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
          }
        }, { u: url, token: wafToken ?? '', extra: CAESARS_API_HEADERS })
      }

      let menuBody: any = null
      if (menuBodyText) {
        try { menuBody = JSON.parse(menuBodyText) } catch { /* fall through */ }
      }
      if (!menuBody) {
        const { status, text } = await authedFetch(SPORTS_MENU_URL)
        if (status === 200) {
          try { menuBody = JSON.parse(text) } catch { /* fall through */ }
        } else {
          log.warn('active sports-menu fetch failed', { status })
        }
      }

      // If we still have no menu, we can't map comp names → UUIDs. Bail.
      if (!menuBody) {
        errors.push('sports-menu unavailable')
        page.off('response', responseHandler)
        return { events: scraped, errors }
      }

      const compUuids = extractCompUuids(menuBody)
      log.info('caesars sports-menu parsed', { totalUuids: compUuids.size })

      // Drive the SPA to each league page so it fires the events-list XHR
      // itself. We passively capture the body.
      for (const comp of COMPETITIONS) {
        if (signal.aborted) break
        const leagueUrl = LEAGUE_URLS[comp.menuName]
        if (!leagueUrl) continue
        try {
          log.debug('visiting league page', { comp: comp.name })
          await page.goto(leagueUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          // Give the events-list + some event calls time to settle.
          await page.waitForTimeout(4_000)
        } catch (e: any) {
          log.warn('league page nav failed', { comp: comp.name, message: e?.message ?? String(e) })
        }
      }
      // One more short grace period so in-flight event bodies finish arriving.
      await page.waitForTimeout(2_000)
      page.off('response', responseHandler)

      log.info('caesars capture', {
        eventsListCount: eventsListBodies.length,
        eventBodyCount: eventBodies.size,
        topApiPaths: Array.from(seenCaesarsPaths.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25),
      })

      // Build a master event list: prefer passively-captured events-list
      // bodies, fall back to mining the menu.
      const eventsByComp = new Map<string, CaesarsEvent[]>()
      for (const body of eventsListBodies) {
        try {
          const parsed = JSON.parse(body)
          const evs = extractEventsFromList(parsed)
          if (evs.length === 0) continue
          // Attach to whatever comp UUID shows up in the body (Liberty wraps
          // events in a competition node). Guess by sampling each known comp.
          for (const comp of COMPETITIONS) {
            const uuid = compUuids.get(comp.menuName.toUpperCase())
              ?? compUuids.get(comp.leagueSlug.toUpperCase())
            if (!uuid) continue
            const serialized = JSON.stringify(parsed)
            if (serialized.includes(uuid)) {
              const prior = eventsByComp.get(comp.menuName) ?? []
              eventsByComp.set(comp.menuName, [...prior, ...evs])
            }
          }
        } catch { /* skip malformed */ }
      }

      for (const comp of COMPETITIONS) {
        if (signal.aborted) break
        const uuid = compUuids.get(comp.menuName.toUpperCase())
          ?? compUuids.get(comp.leagueSlug.toUpperCase())
        if (!uuid) {
          errors.push(`${comp.name}: uuid not found`)
          continue
        }
        let events = eventsByComp.get(comp.menuName) ?? []
        if (events.length === 0) {
          // Fallback: mine from sports-menu body (some deployments inline them).
          events = extractEventsFromMenu(menuBody, uuid)
        }
        // De-dup by event id.
        const seen = new Set<string>()
        events = events.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
        log.info('caesars events', { comp: comp.name, count: events.length })
        if (events.length === 0) continue

        // Fetch single-event bodies: prefer passive captures, otherwise
        // navigate the SPA to each event page so it fires the XHR. Batched.
        const CONCURRENCY = 4
        let cursor = 0
        async function worker() {
          while (cursor < events.length) {
            if (signal.aborted) return
            const idx = cursor++
            const ev = events[idx]
            let bodyText = eventBodies.get(ev.id) ?? null
            if (!bodyText) {
              const eventUrl = `${API_BASE}/events/${ev.id}?useEventPayloadWithTabNav=true`
              const { status, text } = await authedFetch(eventUrl)
              if (status === 200) bodyText = text
              else errors.push(`${comp.name} event ${ev.id}: HTTP ${status}`)
            }
            if (!bodyText) continue
            let body: any
            try { body = JSON.parse(bodyText) } catch {
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
          }
        }
        await Promise.all(Array.from({ length: CONCURRENCY }, worker))
      }

      return { events: scraped, errors }
    }, { useProxy: false })   // PacketStream consistently gets ERR_EMPTY_RESPONSE
                              // from Caesars — try the Railway IP direct instead.
  },
}
