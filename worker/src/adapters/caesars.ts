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

// Caesars' bare `/basketball?id=...` path accepts our residential IP
// (prev cycle extracted 287 UUIDs). The explicit `/ca/on/bet/` prefix
// is stricter and gets ERR_TUNNEL_CONNECTION_FAILED from the same IPs
// — presumably a different WAF rule-set. Stick with the bare path; the
// CA-ON sports-menu fires regardless (confirmed from path log).
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

// League landing pages: bare sport path hits the sport-level quick-picks
// (no competition). To trigger the competition-scoped quick-picks XHR
// (which carries events[] with real teams + startTime), append `?id={uuid}`
// where uuid is the sports-menu competitionId. We build these dynamically
// after parsing the sports-menu body.
const LEAGUE_BASE_URLS: Record<string, string> = {
  NBA: 'https://sportsbook.caesars.com/basketball',
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

/** Parse Caesars quick-picks event name: "|Phoenix Suns| |at| |Oklahoma City Thunder|".
 *  Caesars wraps team-name tokens in pipes with "|at|" as the delimiter. */
function parseQuickPickName(name: string): { away: string; home: string } | null {
  if (!name || typeof name !== 'string') return null
  const idx = name.indexOf('|at|')
  if (idx < 0) return null
  const strip = (s: string) => s.replace(/^\s*\|+\s*|\s*\|+\s*$/g, '').trim()
  const away = strip(name.slice(0, idx))
  const home = strip(name.slice(idx + 4))
  if (!away || !home) return null
  return { away, home }
}

/** Walk a /tabs body (selectedTabId = SCHEDULE|Games by default) for events
 *  with full game markets embedded under keyMarketGroups[].markets[].
 *  Shape: { competitions: [{ id, events: [{ id, name:"A at B", startTime,
 *  competitionId, keyMarketGroups:[{markets:[{name:"|Spread|", line, selections:
 *  [{type:"home", price:{a:-110}}, ...]}]}] }] }] }.
 *  Returns events with pre-extracted GameMarket records so we skip the
 *  per-event fetch path entirely for games covered here. */
function extractEventsFromTabs(body: any): Array<{
  id: string
  name: string
  startTime: string
  competitors: Array<{ id?: string; name: string; home: boolean }>
  competitionId?: string
  gameMarkets: GameMarket[]
}> {
  const out: Array<{
    id: string; name: string; startTime: string
    competitors: Array<{ id?: string; name: string; home: boolean }>
    competitionId?: string; gameMarkets: GameMarket[]
  }> = []
  const comps = Array.isArray(body?.competitions) ? body.competitions : []
  for (const comp of comps) {
    const events = Array.isArray(comp?.events) ? comp.events : []
    const compId = comp?.id ?? comp?.competitionId
    for (const ev of events) {
      const id = ev?.id
      const name = ev?.name
      const startTime = ev?.startTime ?? ev?.scheduledStartTime
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) continue
      if (typeof name !== 'string' || !startTime) continue
      // /tabs uses " at " (space-at-space) as the delimiter, unlike
      // quick-picks' "|at|". Prefer lastIndexOf so "Los Angeles Lakers at
      // Seattle Mariners" (hypothetical) splits correctly if a team name
      // were to contain " at ".
      const idx = name.lastIndexOf(' at ')
      if (idx < 0) continue
      const away = name.slice(0, idx).trim()
      const home = name.slice(idx + 4).trim()
      if (!away || !home) continue

      // Collect game-line markets from keyMarketGroups. Each group is a
      // display bundle (Game Lines, Player Props, etc.); we only want the
      // Game Lines group (moneyline / spread / total).
      let moneyline: any = null, spread: any = null, total: any = null
      const groups = Array.isArray(ev?.keyMarketGroups) ? ev.keyMarketGroups : []
      for (const g of groups) {
        const ms = Array.isArray(g?.markets) ? g.markets : []
        for (const m of ms) {
          const cls = classifyMarket(m)
          if (cls === 'moneyline' && !moneyline) moneyline = m
          else if (cls === 'spread' && !spread) spread = m
          else if (cls === 'total' && !total) total = m
        }
      }

      const gameMarkets: GameMarket[] = []
      const stripPipes = (s: string) => String(s ?? '').replace(/\|/g, '').trim().toLowerCase()
      if (moneyline) {
        let hp: number | null = null, ap: number | null = null
        for (const s of (moneyline.selections ?? moneyline.outcomes ?? [])) {
          const p = extractAmerican(s?.price ?? s)
          if (p == null) continue
          const t = String(s?.type ?? '').toLowerCase()
          if (t === 'home') hp = p
          else if (t === 'away') ap = p
        }
        if (hp != null || ap != null) gameMarkets.push({
          marketType: 'moneyline',
          homePrice: hp, awayPrice: ap, drawPrice: null,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      }
      if (spread) {
        let hp: number | null = null, ap: number | null = null
        const line: number | null = typeof spread.line === 'number' ? spread.line : null
        for (const s of (spread.selections ?? spread.outcomes ?? [])) {
          const p = extractAmerican(s?.price ?? s)
          if (p == null) continue
          const t = String(s?.type ?? '').toLowerCase()
          if (t === 'home') hp = p
          else if (t === 'away') ap = p
        }
        if (hp != null || ap != null) gameMarkets.push({
          marketType: 'spread',
          homePrice: hp, awayPrice: ap, drawPrice: null,
          spreadValue: line,
          totalValue: null, overPrice: null, underPrice: null,
        })
      }
      if (total) {
        let op: number | null = null, up: number | null = null
        const line: number | null = typeof total.line === 'number' ? total.line : null
        for (const s of (total.selections ?? total.outcomes ?? [])) {
          const p = extractAmerican(s?.price ?? s)
          if (p == null) continue
          const t = String(s?.type ?? '').toLowerCase()
          const n = stripPipes(s?.name ?? '')
          if (t === 'over' || n.startsWith('over') || n === 'o') op = p
          else if (t === 'under' || n.startsWith('under') || n === 'u') up = p
        }
        if (op != null || up != null) gameMarkets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null,
          spreadValue: null,
          totalValue: line,
          overPrice: op, underPrice: up,
        })
      }

      out.push({
        id,
        name,
        startTime: String(startTime),
        competitors: [
          { name: away, home: false },
          { name: home, home: true },
        ],
        competitionId: compId,
        gameMarkets,
      })
    }
  }
  return out
}

/** Walk a /quick-picks body for events with the Liberty quick-picks shape:
 *  { id, name: "|Away| |at| |Home|", startTime, competitionId, markets }. */
function extractEventsFromQuickPicks(body: any): Array<CaesarsEvent & { competitionId?: string }> {
  const out: Array<CaesarsEvent & { competitionId?: string }> = []
  const seen = new Set<string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    const id = node.id ?? node.eventId
    const name = node.name ?? node.eventName
    const startTime = node.startTime ?? node.scheduledStartTime ?? node.eventDate
    if (
      typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) &&
      typeof name === 'string' && name.includes('|at|') &&
      startTime && !seen.has(id)
    ) {
      const parsed = parseQuickPickName(name)
      if (parsed) {
        seen.add(id)
        out.push({
          id,
          name,
          startTime: String(startTime),
          competitors: [
            { name: parsed.away, home: false },
            { name: parsed.home, home: true },
          ],
          competitionId: node.competitionId ?? node.competition?.id,
        })
      }
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(body)
  return out
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
  pollIntervalSec: 7200,  // 2h — cap IPRoyal mobile cost (~$25-60/mo CA)
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    // Caesars (AWS WAF) returns ERR_EMPTY_RESPONSE via PacketStream and
    // 403 via direct Railway IP — same geo/IP-reputation class as
    // BetVictor. Park until a CA residential proxy is wired in. Flip
    // CAESARS_ENABLED=1 to retry.
    if (process.env.CAESARS_ENABLED !== '1') {
      log.info('skipped — Caesars WAF blocks Railway/PacketStream IPs; set CAESARS_ENABLED=1 to retry')
      return { events: [], errors: [] }
    }

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
      // Liberty platform moved away from /competitions/:uuid/events towards
      // /competitions/:uuid/{tabs,quick-picks} which return event+market
      // graphs keyed differently. Capture those too; we parse afterwards.
      const compSubRe = /\/competitions\/[0-9a-f-]{36}\/(tabs|quick-picks|events-with-markets)(\?|$)/
      const compSubBodies: Array<{ path: string; body: string }> = []

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
          if (compSubRe.test(u) && compSubBodies.length < 10) {
            const path = new URL(u).pathname
              .replace(/\/[0-9a-f-]{36}/g, '/:uuid')
            compSubBodies.push({ path, body: await resp.text() })
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
      // Retry the seed up to 3 times on proxy-level tunnel errors —
      // IPRoyal sometimes hands us a Starlink exit that can't reach
      // sportsbook.caesars.com; a 2nd/3rd attempt often lands on a
      // different exit that succeeds.
      let seedOk = false
      let lastSeedErr: any = null
      for (let attempt = 1; attempt <= 3 && !seedOk; attempt++) {
        try {
          await page.goto(SEED_ROOT, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          seedOk = true
        } catch (e: any) {
          lastSeedErr = e
          const msg = e?.message ?? String(e)
          const transient = /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET/.test(msg)
          if (attempt < 3 && transient) {
            log.warn('caesars seed transient — retrying', { attempt, message: msg })
            await page.waitForTimeout(1_500)
            continue
          }
          log.error('homepage seed failed', { attempt, message: msg })
        }
      }
      if (!seedOk) {
        errors.push(`seed: ${lastSeedErr?.message ?? lastSeedErr}`)
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
      // itself. We passively capture the body. URLs are composed from the
      // sports-menu competitionIds so each league fires a competition-scoped
      // /quick-picks (bare sport paths only fire sport-level which carries
      // no event/competition mapping).
      for (const comp of COMPETITIONS) {
        if (signal.aborted) break
        const base = LEAGUE_BASE_URLS[comp.menuName]
        if (!base) continue
        const uuid = compUuids.get(comp.menuName.toUpperCase())
          ?? compUuids.get(comp.leagueSlug.toUpperCase())
        const leagueUrl = uuid ? `${base}?id=${uuid}` : base
        try {
          log.debug('visiting league page', { comp: comp.name, url: leagueUrl })
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
        compSubBodies: compSubBodies.length,
        topApiPaths: Array.from(seenCaesarsPaths.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25),
      })

      // Dump one sample body per distinct competition sub-endpoint so we
      // can see which (tabs / quick-picks / events-with-markets) holds the
      // events graph and wire a parser next iteration. For /tabs bodies,
      // sample further in (default view = Games tab, events embedded after
      // the tab nav).
      const subSeen = new Set<string>()
      for (const { path, body } of compSubBodies) {
        if (subSeen.has(path)) continue
        subSeen.add(path)
        let topKeys: string[] | null = null
        try {
          const parsed = JSON.parse(body)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            topKeys = Object.keys(parsed).slice(0, 20)
          } else if (Array.isArray(parsed)) {
            topKeys = [`__array__len=${parsed.length}`]
          }
        } catch { /* log anyway */ }
        // /tabs bodies lead with ~3KB of tab nav; dump a deeper window to
        // reach the events[] / competitions[] payload.
        const sampleLen = path.includes('/tabs') ? 6000 : 2500
        const sampleOff = path.includes('/tabs') ? 3000 : 0
        log.info('caesars comp sub-endpoint sample', {
          path, topKeys, bodyLen: body.length,
          sample: body.slice(sampleOff, sampleOff + sampleLen),
        })
      }

      // Build a master event list. Preferred source is /quick-picks bodies
      // (Liberty moved events here from /competitions/:uuid/events). Each
      // event carries competitionId inline, so we group by that directly
      // rather than guessing via serialized-substring.
      const eventsByComp = new Map<string, CaesarsEvent[]>()
      const compByUuid = new Map<string, Competition>()
      for (const comp of COMPETITIONS) {
        const uuid = compUuids.get(comp.menuName.toUpperCase())
          ?? compUuids.get(comp.leagueSlug.toUpperCase())
        if (uuid) compByUuid.set(uuid, comp)
      }
      // Pre-extracted game markets keyed by event UUID. Populated from
      // /tabs bodies which carry full moneyline/spread/total graphs inline.
      const gameMarketsByEventId = new Map<string, GameMarket[]>()

      // /tabs bodies carry the Games grid: events + markets inline. This is
      // the primary source of main lines.
      for (const { path, body } of compSubBodies) {
        if (!/\/tabs(?:\?|$)/.test(path)) continue
        try {
          const parsed = JSON.parse(body)
          const evs = extractEventsFromTabs(parsed)
          for (const ev of evs) {
            const comp = ev.competitionId ? compByUuid.get(ev.competitionId) : undefined
            if (!comp) continue
            const prior = eventsByComp.get(comp.menuName) ?? []
            eventsByComp.set(comp.menuName, [...prior, {
              id: ev.id, name: ev.name, startTime: ev.startTime,
              competitors: ev.competitors,
            }])
            if (ev.gameMarkets.length) {
              gameMarketsByEventId.set(ev.id, ev.gameMarkets)
            }
          }
        } catch { /* skip malformed */ }
      }
      // /quick-picks bodies carry extra events (parlay promos) that may not
      // be on the Games tab yet (future/boost markets). No main lines here.
      for (const { path, body } of compSubBodies) {
        if (!/\/quick-picks(?:\?|$)/.test(path)) continue
        try {
          const parsed = JSON.parse(body)
          const evs = extractEventsFromQuickPicks(parsed)
          for (const ev of evs) {
            const comp = ev.competitionId ? compByUuid.get(ev.competitionId) : undefined
            if (!comp) continue
            const prior = eventsByComp.get(comp.menuName) ?? []
            eventsByComp.set(comp.menuName, [...prior, ev])
          }
        } catch { /* skip malformed */ }
      }
      // Legacy fallback — /events body shape. Kept in case Caesars restores it.
      for (const body of eventsListBodies) {
        try {
          const parsed = JSON.parse(body)
          const evs = extractEventsFromList(parsed)
          if (evs.length === 0) continue
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
            const home = ev.competitors.find(c => c.home) ?? ev.competitors[0]
            const away = ev.competitors.find(c => !c.home) ?? ev.competitors[1]

            // Pre-extracted markets from /tabs — skip the per-event fetch.
            const preMarkets = gameMarketsByEventId.get(ev.id)
            if (preMarkets && preMarkets.length) {
              scraped.push({
                event: {
                  externalId: ev.id,
                  homeTeam: home.name,
                  awayTeam: away.name,
                  startTime: ev.startTime,
                  leagueSlug: comp.leagueSlug,
                  sport: comp.sport,
                },
                gameMarkets: preMarkets,
                props: [],
              })
              continue
            }

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
    }, { useProxy: 'mobile', rotateSession: true })
    // Residential proxy (IPRoyal Starlink) restored. The earlier
    // PacketStream ERR_EMPTY_RESPONSE is gone — AWS WAF treats residential
    // CA IPs as clean consumer traffic.
  },
}
