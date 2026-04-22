/**
 * theScore Bet (Ontario) — real adapter.
 *
 * Platform: Penn Interactive on Apollo/GraphQL at
 *   https://sportsbook.ca-on.thescore.bet/graphql/persisted_queries/<sha>
 *
 * Auth: `x-anonymous-authorization: Bearer <JWT>` — the JWT is minted by
 * the SPA on first load and bound to session cookies + Cloudflare's
 * __cf_bm. We let the SPA fire the CompetitionPageSectionLinesTabNode
 * persisted query from the right pages and snarf the response body.
 *
 * Response shape (confirmed from DevTools curl):
 *   { data: { node: { ... competition section with lines ... } } }
 * The node contains sections / cards / events / markets / selections with
 * americanOdds fields. Shape is permissive — walk for event-like nodes.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedEvent } from '../lib/types.js'

// Real competition-page deep links — confirmed user-facing URL shape:
//   /sport/<sport>/organization/<country>/competition/<league>#lines
// The #lines hash is what switches the SPA to the lines tab and causes
// Apollo to fire CompetitionPageSectionLinesTabNode. Without it, the SPA
// only fires Startup / Menu / LiveEventsCount queries.
const LEAGUE_URLS: Array<{ url: string; leagueSlug: string; sport: string; match: RegExp }> = [
  { url: 'https://sportsbook.thescore.bet/sport/basketball/organization/united-states/competition/nba#lines', leagueSlug: 'nba', sport: 'basketball', match: /\bnba\b/i },
  { url: 'https://sportsbook.thescore.bet/sport/baseball/organization/united-states/competition/mlb#lines',   leagueSlug: 'mlb', sport: 'baseball',   match: /\bmlb\b/i },
  { url: 'https://sportsbook.thescore.bet/sport/hockey/organization/united-states/competition/nhl#lines',     leagueSlug: 'nhl', sport: 'ice_hockey', match: /\bnhl\b/i },
]

// GraphQL persisted-query URL — SHA hash changes per client version but
// path shape is stable.
const GQL_PATH_RE = /\/graphql\/persisted_queries\/[a-f0-9]{32,}/i

interface TsbEvent {
  id?: string
  title?: string
  name?: string
  startTime?: string
  scheduledStart?: string
  competitors?: Array<{ name?: string; homeAway?: 'home' | 'away'; isHome?: boolean; role?: string }>
  markets?: any[]
  lines?: any[]
  mainLines?: any
  [key: string]: any
}

function priceOf(sel: any): number | null {
  if (!sel) return null
  if (typeof sel.americanOdds === 'number') return sel.americanOdds
  if (typeof sel.americanOdds === 'string') {
    const n = Number(sel.americanOdds.replace('+', ''))
    return isNaN(n) ? null : n
  }
  if (typeof sel.decimalOdds === 'number') {
    const d = sel.decimalOdds
    if (d <= 1) return null
    if (d >= 2) return Math.round((d - 1) * 100)
    return Math.round(-100 / (d - 1))
  }
  if (typeof sel.odds === 'number') return sel.odds
  return null
}

function lineOf(sel: any): number | null {
  for (const k of ['line', 'point', 'handicap', 'spread', 'totalPoints', 'total']) {
    const v = sel?.[k]
    if (typeof v === 'number' && isFinite(v)) return v
    if (typeof v === 'string') { const n = Number(v); if (!isNaN(n)) return n }
  }
  return null
}

function classifyMarket(name: string): 'moneyline' | 'spread' | 'total' | null {
  const n = name.toLowerCase()
  if (/\b(1st|2nd|3rd|4th|first|second|third|fourth|half|quarter|inning|period|race to|alt)\b/.test(n)) return null
  if (/money\s*line|moneyline|match\s*winner|to\s*win\b/.test(n)) return 'moneyline'
  if (/run\s*line|puck\s*line|point\s*spread|\bspread\b|handicap/.test(n)) return 'spread'
  if (/\btotal\b|over\/?under|totals/.test(n)) return 'total'
  return null
}

/** Walk a GraphQL response looking for event-shaped nodes. theScore's
 *  Apollo schema uses `__typename: "RichEvent"` or `"Event"` on event
 *  nodes; each has competitors/markets/lines. We also collect the
 *  competition/league name via nearest-ancestor `name` field. */
function walkForEvents(body: any): TsbEvent[] {
  const out: TsbEvent[] = []
  const seen = new Set<string>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const n of node) walk(n); return }
    const typename = node.__typename ?? ''
    const isEvent = /Event$/i.test(typename) || (
      node.id && (node.competitors || node.title || node.startTime) && (node.markets || node.lines || node.mainLines)
    )
    if (isEvent && node.id && !seen.has(String(node.id))) {
      seen.add(String(node.id))
      out.push(node as TsbEvent)
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(body)
  return out
}

function extractTeams(e: TsbEvent): { home: string; away: string } | null {
  const cs = Array.isArray(e.competitors) ? e.competitors : []
  if (cs.length >= 2) {
    const home = cs.find(c => c.homeAway === 'home' || c.isHome === true || c.role === 'home')
    const away = cs.find(c => c !== home)
    const hn = home?.name ?? cs[0]?.name
    const an = away?.name ?? cs[1]?.name
    if (hn && an) return { home: String(hn), away: String(an) }
  }
  // Fallback: split title on " @ " (Penn's convention: away @ home)
  if (typeof e.title === 'string' && e.title.includes(' @ ')) {
    const [away, home] = e.title.split(' @ ').map(s => s.trim())
    if (home && away) return { home, away }
  }
  return null
}

function extractStart(e: TsbEvent): string | null {
  if (typeof e.startTime === 'string' && e.startTime.length >= 10) return e.startTime
  if (typeof e.scheduledStart === 'string' && e.scheduledStart.length >= 10) return e.scheduledStart
  return null
}

function extractGameMarkets(e: TsbEvent, home: string, away: string): GameMarket[] {
  // Penn schema commonly ships main lines under `mainLines` or flat `markets`
  // / `lines` arrays. Handle both.
  const markets: any[] = []
  if (Array.isArray(e.markets)) markets.push(...e.markets)
  if (Array.isArray(e.lines)) markets.push(...e.lines)
  if (e.mainLines && typeof e.mainLines === 'object') {
    for (const v of Object.values(e.mainLines)) {
      if (Array.isArray(v)) markets.push(...v)
      else if (v && typeof v === 'object') markets.push(v)
    }
  }
  if (markets.length === 0) return []

  const byType: Record<'moneyline' | 'spread' | 'total', any[]> = { moneyline: [], spread: [], total: [] }
  for (const m of markets) {
    const label = String(m?.name ?? m?.description ?? m?.marketType ?? m?.__typename ?? '')
    const t = classifyMarket(label)
    if (!t) continue
    byType[t].push(m)
  }

  const out: GameMarket[] = []
  const selectionsOf = (m: any): any[] =>
    Array.isArray(m?.selections) ? m.selections
    : Array.isArray(m?.outcomes)  ? m.outcomes
    : Array.isArray(m?.options)   ? m.options
    : []

  // Moneyline
  if (byType.moneyline[0]) {
    const m = byType.moneyline[0]
    let hp: number | null = null, ap: number | null = null
    for (const s of selectionsOf(m)) {
      const n = String(s?.name ?? '').toLowerCase()
      const p = priceOf(s)
      if (p == null) continue
      if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n))) hp = p
      else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n))) ap = p
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
      for (const s of selectionsOf(m)) {
        const n = String(s?.name ?? '').toLowerCase()
        const p = priceOf(s); const line = lineOf(s)
        if (p == null) continue
        if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n))) {
          hp = p; if (spread == null && line != null) spread = line
        } else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n))) {
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
      for (const s of selectionsOf(m)) {
        const n = String(s?.name ?? '').toLowerCase()
        const p = priceOf(s); const line = lineOf(s)
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

export const thescoreAdapter: BookAdapter = {
  slug: 'thescore',
  name: 'theScore Bet (Ontario)',
  pollIntervalSec: 300,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      // Passively capture every GraphQL persisted-query response — the
      // CompetitionPageSectionLinesTabNode operation ships the event+line
      // graph for the league competition page. We include auxiliary
      // operations because the line data is sometimes returned across
      // multiple queries on the same page.
      const gqlBodies: Array<{ url: string; body: string }> = []
      const seenOps = new Map<string, number>()
      const responseHandler = async (resp: import('playwright').Response) => {
        const u = resp.url()
        if (!GQL_PATH_RE.test(u)) return
        if (resp.status() !== 200) return
        try {
          const text = await resp.text()
          gqlBodies.push({ url: u, body: text })
          // Track operationName from query string for diagnostics.
          const m = u.match(/operationName=([^&]+)/)
          if (m) {
            const op = decodeURIComponent(m[1])
            seenOps.set(op, (seenOps.get(op) ?? 0) + 1)
          }
        } catch { /* stream closed */ }
      }
      page.on('response', responseHandler)

      // Drive the SPA through NBA / MLB / NHL competition pages.
      // Give Apollo a long dwell — the #lines hash handler fires the
      // CompetitionPageSectionLinesTabNode query asynchronously after
      // hydration, and on slow-load it can take ~10s to land.
      let leagueHit: typeof LEAGUE_URLS[number] | null = null
      for (const L of LEAGUE_URLS) {
        if (signal.aborted) break
        leagueHit = L
        try {
          log.info('thescore seeding', { url: L.url })
          await page.goto(L.url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
          // Belt-and-suspenders: re-set the hash client-side in case
          // page.goto swallowed it (sometimes happens on redirect chains).
          try { await page.evaluate(() => { if (!location.hash) location.hash = '#lines' }) } catch { /* ignore */ }
          await page.waitForTimeout(12_000)
        } catch (e: any) {
          log.warn('thescore nav failed', { url: L.url, message: e?.message ?? String(e) })
        }
      }
      page.off('response', responseHandler)

      log.info('thescore captured', {
        responses: gqlBodies.length,
        operations: Array.from(seenOps.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12),
      })

      if (gqlBodies.length === 0) return { events: scraped, errors }

      // Parse every captured body; collect distinct events across all of them.
      const seen = new Set<string>()
      let loggedSample = false
      let loggedLinesBody = false
      for (const { url: bodyUrl, body } of gqlBodies) {
        let json: any
        try { json = JSON.parse(body) } catch { continue }

        // Dump the first full CompetitionPageSectionLinesTabNode body so
        // we can see where markets/prices live in the Apollo response.
        // The event-summary walker only grabs the StandardEvent leaves; the
        // line prices hang off a sibling shape we haven't mapped yet.
        if (!loggedLinesBody && bodyUrl.includes('CompetitionPageSectionLinesTabNode')) {
          loggedLinesBody = true
          const roots = json?.data && typeof json.data === 'object' ? Object.keys(json.data) : []
          log.info('thescore lines body shape', {
            dataKeys: roots,
            bodyLen: body.length,
            // First 4000 chars is enough to see the graph structure
            // without flooding the log.
            headSample: body.slice(0, 4000),
          })
        }

        const events = walkForEvents(json)
        if (events.length === 0) continue

        if (!loggedSample) {
          loggedSample = true
          log.info('thescore sample event', {
            keys: Object.keys(events[0]).slice(0, 30),
            sample: JSON.stringify(events[0]).slice(0, 2500),
          })
        }

        for (const ev of events) {
          const id = String(ev.id ?? '')
          if (!id || seen.has(id)) continue
          const teams = extractTeams(ev)
          const start = extractStart(ev)
          if (!teams || !start) continue
          seen.add(id)
          // Best-effort league/sport assignment — pick whichever league URL
          // this body most likely came from. The SPA navigates through all
          // three in order, and body order matches; fall back to regex on the
          // event title as a safety net.
          let leagueSlug = leagueHit?.leagueSlug ?? 'nba'
          let sport = leagueHit?.sport ?? 'basketball'
          const title = String(ev.title ?? ev.name ?? '').toLowerCase()
          for (const L of LEAGUE_URLS) {
            if (L.match.test(title)) { leagueSlug = L.leagueSlug; sport = L.sport; break }
          }

          const event: NormalizedEvent = {
            externalId: id,
            homeTeam: teams.home,
            awayTeam: teams.away,
            startTime: start,
            leagueSlug,
            sport,
          }
          const gameMarkets = extractGameMarkets(ev, teams.home, teams.away)
          scraped.push({ event, gameMarkets, props: [] })
        }
      }

      log.info('thescore scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true, ignoreHTTPSErrors: true })
  },
}
