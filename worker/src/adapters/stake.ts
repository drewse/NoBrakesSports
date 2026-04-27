/**
 * Stake.com (offshore crypto sportsbook) — capture-and-parse adapter.
 *
 * Reconnaissance summary:
 *   - Direct datacenter probes 403 on every static path (Cloudflare WAF).
 *   - The single exception is `https://stake.com/_api/graphql`: the
 *     endpoint is reachable from datacenter IPs, but Apollo introspection
 *     is disabled and every guessed operationName returns
 *     "Unknown operation named X" — Stake locks the schema to a fixed
 *     registry of known operations.
 *   - Therefore, the only way to discover the actual operationNames /
 *     query strings is to load the SPA in Chromium through a proxy that
 *     clears the CF JS challenge.
 *   - Stake.us is sweepstakes (account-gated for sportsbook view), so
 *     stake.com is the more permissive target despite the offshore label.
 *
 * Adapter strategy:
 *   1. Open a Playwright context behind PROXY_URL_US / MOBILE_PROXY_URL_US.
 *      Land on stake.com first (CF cookies settle), then navigate the
 *      sportsbook league pages (NBA / MLB / NHL).
 *   2. Listen on every POST to `/_api/graphql`. Capture
 *      (operationName, variables, response shape sample) into a per-run
 *      log so we can iterate on the parser from Railway log output.
 *   3. Apply best-effort heuristic parsers to the captured responses —
 *      they recursively walk the JSON looking for arrays of objects
 *      that "look like events" (id + name/title + startTime + competitors)
 *      and arrays that "look like markets" (outcomes with odds). This
 *      gets us partial coverage on the first run even before we know the
 *      exact schema.
 *   4. Return the parsed ScrapedEvent[]. Rows that don't parse cleanly
 *      get logged with their operationName so we can wire a typed parser
 *      in iteration 2.
 *
 * Parking conditions:
 *   - If MOBILE_PROXY_URL_US / PROXY_URL_US isn't set on Railway, skip
 *     the run (we don't have the proxy to clear CF).
 *   - If the seed page itself 403s after CF settles, escalate slug to
 *     mobile-only and bump the poll cadence.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, ScrapedEvent, GameMarket } from '../lib/types.js'

const SEED_URL    = 'https://stake.com/sports'
const GRAPHQL_URL = '/_api/graphql'

interface LeagueTarget {
  url: string
  leagueSlug: string
  sport: 'basketball' | 'baseball' | 'ice_hockey'
}

const LEAGUES: LeagueTarget[] = [
  { url: 'https://stake.com/sports/basketball/nba', leagueSlug: 'nba', sport: 'basketball' },
  { url: 'https://stake.com/sports/baseball/mlb',   leagueSlug: 'mlb', sport: 'baseball' },
  { url: 'https://stake.com/sports/ice-hockey/nhl', leagueSlug: 'nhl', sport: 'ice_hockey' },
]

/** Captured GraphQL exchange — request + response body for one operation. */
interface GraphQLCapture {
  url: string
  league: string
  operationName: string | null
  variables: any
  responseStatus: number
  /** Parsed response.data, if JSON. null if response was not JSON. */
  data: any
  /** Raw size for diagnostic logging. */
  bytes: number
}

export const stakeAdapter: BookAdapter = {
  slug: 'stake',
  name: 'Stake.com',
  // Mobile US proxy is needed to clear CF Bot Management. Direct datacenter
  // gets 403 on the seed page even after the JS challenge.
  needsBrowser: true,
  pollIntervalSec: 1800,  // 30 min — capture-and-parse is more expensive than a JSON adapter

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    // Gate on the US proxy env vars — without one, CF will 403 the seed
    // page and the run wastes Chromium time + bandwidth.
    if (!process.env.PROXY_URL_US && !process.env.MOBILE_PROXY_URL_US) {
      log.warn('stake skipped: PROXY_URL_US / MOBILE_PROXY_URL_US not set')
      return { events: [], errors: ['no us proxy configured'] }
    }

    return withPage(async (page) => {
      const errors: string[] = []
      const captures: GraphQLCapture[] = []
      let currentLeague = '<seed>'

      // 1. Wire up the GraphQL response sniffer. We listen on every
      //    response, filter to /_api/graphql POSTs, and snapshot
      //    operationName + variables + response body.
      page.on('response', async (resp) => {
        try {
          const url = resp.url()
          if (!url.includes(GRAPHQL_URL)) return
          const req = resp.request()
          if (req.method() !== 'POST') return
          let postBody: any = null
          try { postBody = JSON.parse(req.postData() ?? '') } catch { /* non-json body */ }
          const operationName: string | null = postBody?.operationName ?? null
          const variables = postBody?.variables ?? {}

          let data: any = null
          let bytes = 0
          try {
            const text = await resp.text()
            bytes = text.length
            data = JSON.parse(text)?.data ?? null
          } catch {
            data = null
          }

          captures.push({
            url, league: currentLeague,
            operationName, variables,
            responseStatus: resp.status(), data, bytes,
          })
        } catch {
          // Browser may have closed mid-response — ignore.
        }
      })

      // 2. Land on the sports root first to settle CF cookies. If this
      //    page 403s, the proxy IP is flagged and we should escalate.
      try {
        const seedResp = await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        if (!seedResp || seedResp.status() === 403) {
          errors.push(`seed 403 (CF Bot block) — escalate to mobile proxy`)
          return { events: [], errors }
        }
      } catch (e: any) {
        errors.push(`seed nav failed: ${e?.message ?? String(e)}`)
        return { events: [], errors }
      }

      // 3. Visit each league page; the SPA fires its own GraphQL queries
      //    on mount, which our response sniffer captures.
      for (const league of LEAGUES) {
        if (signal.aborted) break
        currentLeague = league.leagueSlug
        try {
          await page.goto(league.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          // Let lazy queries settle. Stake fires events list, then each
          // event card lazy-loads its own market XHR.
          await page.waitForTimeout(4_000)
        } catch (e: any) {
          errors.push(`${league.leagueSlug} nav: ${e?.message ?? String(e)}`)
          continue
        }
      }

      // 4. Diagnostic — surface what we captured so the next iteration
      //    can target specific operations explicitly.
      const opSummary = new Map<string, number>()
      for (const c of captures) {
        const k = `${c.league}::${c.operationName ?? 'null'}::${c.responseStatus}`
        opSummary.set(k, (opSummary.get(k) ?? 0) + 1)
      }
      log.info('stake graphql captures', {
        total: captures.length,
        bytes: captures.reduce((s, c) => s + c.bytes, 0),
        operations: Object.fromEntries(opSummary),
      })

      // 5. Heuristic parse: walk the captured response data shapes and
      //    pull anything that looks like an event with markets. This is
      //    the MVP path — once Railway logs reveal the real
      //    operationNames + JSON paths, we can replace the heuristic
      //    with a typed parser.
      const scraped: ScrapedEvent[] = []
      for (const cap of captures) {
        if (cap.responseStatus !== 200) continue
        if (cap.data == null) continue
        const league = LEAGUES.find(l => l.leagueSlug === cap.league)
        if (!league) continue
        try {
          const events = extractStakeEvents(cap.data, league)
          for (const ev of events) scraped.push(ev)
        } catch (e: any) {
          errors.push(`parse ${cap.operationName}: ${e?.message ?? String(e)}`)
        }
      }

      // De-dup by externalId — heuristic walker may surface the same
      // event from multiple captured responses (events list + market list).
      // Fall back to a sortedTeams key when externalId is missing so
      // non-Stake-id matches still collapse cleanly.
      const merged = new Map<string, ScrapedEvent>()
      const dedupKey = (ev: ScrapedEvent): string =>
        ev.event.externalId
          ?? `${ev.event.leagueSlug}|${[ev.event.homeTeam, ev.event.awayTeam].sort().join('|')}`
      for (const ev of scraped) {
        const k = dedupKey(ev)
        const existing = merged.get(k)
        if (!existing) { merged.set(k, ev); continue }
        if (ev.gameMarkets.length > existing.gameMarkets.length) {
          merged.set(k, ev)
        }
      }

      log.info('stake scrape summary', {
        events: merged.size,
        gameMarkets: [...merged.values()].reduce((s, e) => s + e.gameMarkets.length, 0),
        errors: errors.length,
      })
      return { events: [...merged.values()], errors }
    }, { useProxy: 'us-mobile' })
  },
}

// ── Heuristic Stake response walker ──────────────────────────────────────────
// Stake's GraphQL responses for sportsbook tend to look like:
//   { sport: { categories: [{ groups: [{ events: [{ id, name, startTime,
//     competitors: [{ name }, { name }], markets: [{ name, selections:
//     [{ name, price: { decimal } }] }] }] }] }] } }
//
// Field names vary across endpoints; we walk recursively looking for arrays
// of objects that match the event-shape predicate and the market-shape
// predicate. False positives drop out at the writer stage (no canonical
// match → not written).

interface StakeEventShape {
  id: string
  name: string
  startTime: string
  homeName: string
  awayName: string
  markets: GameMarket[]
}

function extractStakeEvents(node: any, league: LeagueTarget): ScrapedEvent[] {
  const out: ScrapedEvent[] = []
  visit(node, (n) => {
    const ev = matchEvent(n)
    if (!ev) return
    out.push({
      event: {
        externalId: ev.id,
        homeTeam: ev.homeName,
        awayTeam: ev.awayName,
        startTime: ev.startTime,
        leagueSlug: league.leagueSlug,
        sport: league.sport,
      },
      gameMarkets: ev.markets,
      props: [],
    })
  })
  return out
}

function visit(node: any, fn: (n: any) => void): void {
  if (node == null) return
  if (Array.isArray(node)) {
    for (const item of node) visit(item, fn)
    return
  }
  if (typeof node !== 'object') return
  fn(node)
  for (const v of Object.values(node)) visit(v, fn)
}

function matchEvent(n: any): StakeEventShape | null {
  if (!n || typeof n !== 'object') return null
  // Required: id, a name/title, a start time, and a way to identify two competitors.
  const id = String(n.id ?? n.uid ?? n.eventId ?? '').trim()
  if (!id) return null
  const startRaw = n.startTime ?? n.startsAt ?? n.scheduledTime ?? n.commencesAt
  if (!startRaw) return null
  const startTime = new Date(startRaw).toISOString()
  if (isNaN(new Date(startTime).getTime())) return null

  // Two competitors. Stake exposes them as either `competitors`,
  // `participants`, `homeTeam`/`awayTeam`, or split into `name` like "X vs Y".
  let home = '', away = ''
  if (n.competitors && Array.isArray(n.competitors) && n.competitors.length >= 2) {
    // Order in the array isn't reliable — pick by isHome flag if present.
    const homeC = n.competitors.find((c: any) => c?.isHome === true) ?? n.competitors[0]
    const awayC = n.competitors.find((c: any) => c?.isHome === false) ?? n.competitors[1]
    home = (homeC?.name ?? homeC?.fullName ?? '').trim()
    away = (awayC?.name ?? awayC?.fullName ?? '').trim()
  } else if (n.homeTeam && n.awayTeam) {
    home = String(n.homeTeam?.name ?? n.homeTeam).trim()
    away = String(n.awayTeam?.name ?? n.awayTeam).trim()
  } else if (typeof n.name === 'string' && /\bvs\.?\b/i.test(n.name)) {
    const parts = n.name.split(/\s+vs\.?\s+/i)
    if (parts.length === 2) { home = parts[0].trim(); away = parts[1].trim() }
  }
  if (!home || !away) return null

  // Markets — best-effort. Look for arrays of "market" objects with selections.
  const markets: GameMarket[] = []
  const candidateMarkets = (n.markets ?? n.fixtureMarkets ?? n.bettingMarkets ?? []) as any[]
  for (const m of candidateMarkets) {
    const parsed = matchMarket(m, home, away)
    if (parsed) markets.push(parsed)
  }

  return { id, name: n.name ?? `${away} @ ${home}`, startTime, homeName: home, awayName: away, markets }
}

function matchMarket(m: any, home: string, away: string): GameMarket | null {
  if (!m || typeof m !== 'object') return null
  const name = String(m.name ?? m.title ?? m.marketType ?? '').toLowerCase()
  const selections = (m.selections ?? m.outcomes ?? m.options ?? []) as any[]
  if (selections.length === 0) return null

  // Decimal odds → American.
  const toAmerican = (sel: any): number | null => {
    const dec = Number(sel?.price?.decimal ?? sel?.price ?? sel?.odds?.decimal ?? sel?.odds ?? NaN)
    if (!isFinite(dec) || dec <= 1) return null
    if (dec >= 2) return Math.round((dec - 1) * 100)
    return Math.round(-100 / (dec - 1))
  }
  const matchSide = (sel: any, target: string): boolean => {
    const n = String(sel?.name ?? sel?.title ?? '').toLowerCase()
    const t = target.toLowerCase()
    return n === t || t.includes(n) || n.includes(t.split(/\s+/).pop() ?? '')
  }

  if (name.includes('moneyline') || name === 'match' || name === 'winner' || name === '1x2') {
    let h: number | null = null, a: number | null = null, d: number | null = null
    for (const s of selections) {
      const american = toAmerican(s)
      if (american == null) continue
      const sn = String(s?.name ?? '').toLowerCase()
      if (sn === 'draw' || sn === 'tie') { d = american; continue }
      if (matchSide(s, home)) h = american
      else if (matchSide(s, away)) a = american
    }
    if (h != null || a != null) {
      return { marketType: 'moneyline', homePrice: h, awayPrice: a, drawPrice: d,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null }
    }
  }

  if (name.includes('spread') || name.includes('handicap') || name.includes('run line') || name.includes('puck line')) {
    let h: number | null = null, a: number | null = null, line: number | null = null
    for (const s of selections) {
      const american = toAmerican(s)
      if (american == null) continue
      const handicap = Number(s?.handicap ?? s?.line ?? s?.points ?? NaN)
      if (matchSide(s, home)) { h = american; if (isFinite(handicap)) line = handicap }
      else if (matchSide(s, away)) a = american
    }
    if (h != null || a != null) {
      return { marketType: 'spread', homePrice: h, awayPrice: a, drawPrice: null,
        spreadValue: line, totalValue: null, overPrice: null, underPrice: null }
    }
  }

  if (name.includes('total') || name.includes('over/under') || name.startsWith('o/u')) {
    let over: number | null = null, under: number | null = null, line: number | null = null
    for (const s of selections) {
      const american = toAmerican(s)
      if (american == null) continue
      const sn = String(s?.name ?? '').toLowerCase()
      const handicap = Number(s?.handicap ?? s?.line ?? s?.points ?? NaN)
      if (sn.startsWith('over') || sn === 'o') { over = american; if (isFinite(handicap)) line = handicap }
      else if (sn.startsWith('under') || sn === 'u') { under = american }
    }
    if (over != null || under != null) {
      return { marketType: 'total', homePrice: null, awayPrice: null, drawPrice: null,
        spreadValue: null, totalValue: line, overPrice: over, underPrice: under }
    }
  }

  return null
}
