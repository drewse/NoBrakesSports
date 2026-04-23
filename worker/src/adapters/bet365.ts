/**
 * Bet365 Ontario adapter (Playwright edition for the Railway worker).
 *
 * Ported from lib/pipelines/adapters/bet365-on.ts. Same Cloudflare bypass +
 * pipe-protocol parser, but emits the worker's BookAdapter shape so it
 * pipes into the shared writer.
 *
 * Endpoint:
 *   GET https://www.on.bet365.ca/matchmarketscontentapi/markets?lid=...&pd=...
 *   Auth: none — Cloudflare Bot Management gates access by TLS
 *         fingerprint + cookies, which a real Chromium context provides.
 *
 * Response: bet365's pipe-delimited text protocol.
 *   Records separated by '|', fields by ';'.
 *   PA records carry the actual prices:
 *     FI = fixture id, NA = away team (or "Over"/"Under"), N2 = home team,
 *     BC = start time YYYYMMDDHHmmss UTC, HD = handicap, OD = fractional odds.
 *
 * Market type IDs (E value in pd):
 *   960  = Moneyline
 *   1453 = Spread
 *   1454 = Total
 *
 * To add a competition: open DevTools on www.on.bet365.ca, find a
 * /matchmarketscontentapi/markets request, copy lid/cid/cgid/ctid from
 * the query string + B/C/D from the pd fragment.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, NormalizedEvent, GameMarket } from '../lib/types.js'

const BASE = 'https://www.on.bet365.ca'

interface Bet365Competition {
  name: string
  leagueSlug: string
  sport: string
  /** URL fragment that bet365 navigates to for this league's market grid.
   *  Loading it causes bet365's own JS to fire the matchmarketscontentapi
   *  requests with valid x-net-sync-term + cookies — we capture those
   *  responses via waitForResponse. */
  pageFragment: string
  lid: number
  cid: number
  cgid: number
  ctid: number
  pdB: number
  pdC: number
  pdD: number
}

// Captured from DevTools on www.on.bet365.ca per league.
const COMPETITIONS: Bet365Competition[] = [
  {
    name: 'NBA',
    leagueSlug: 'nba',
    sport: 'basketball',
    pageFragment: '#/AC/B18/C20604387/D48/',
    lid: 32, cid: 272, cgid: 2, ctid: 272,
    pdB: 18, pdC: 20604387, pdD: 48,
  },
]

const MARKET_TYPE_IDS: Array<{ id: number; type: 'moneyline' | 'spread' | 'total' }> = [
  { id: 960,  type: 'moneyline' },
  { id: 1453, type: 'spread' },
  { id: 1454, type: 'total' },
]

const API_HEADERS: Record<string, string> = {
  Origin: BASE,
  Referer: `${BASE}/`,
}

function buildUrl(comp: Bet365Competition, marketTypeId: number): string {
  const pdRaw = `#AC#B${comp.pdB}#C${comp.pdC}#D${comp.pdD}#E${marketTypeId}#F10#`
  const pd = encodeURIComponent(pdRaw)
  return `${BASE}/matchmarketscontentapi/markets?lid=${comp.lid}&zid=0&pd=${pd}&cid=${comp.cid}&cgid=${comp.cgid}&ctid=${comp.ctid}`
}

interface Bet365Record {
  type: string
  fields: Record<string, string>
}

function parseResponse(text: string): Bet365Record[] {
  const out: Bet365Record[] = []
  for (const chunk of text.split('|')) {
    const trimmed = chunk.trim()
    if (!trimmed) continue
    const parts = trimmed.split(';')
    const type = parts[0]
    if (!type) continue
    const fields: Record<string, string> = {}
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf('=')
      if (eq === -1) continue
      fields[parts[i].slice(0, eq)] = parts[i].slice(eq + 1)
    }
    out.push({ type, fields })
  }
  return out
}

/** Convert fractional odds ("10/11", "5/4") to American integer. */
function fractionalToAmerican(frac: string): number | null {
  const slash = frac.indexOf('/')
  if (slash === -1) return null
  const num = Number(frac.slice(0, slash))
  const den = Number(frac.slice(slash + 1))
  if (!isFinite(num) || !isFinite(den) || den === 0) return null
  const fraction = num / den
  return fraction >= 1 ? Math.round(fraction * 100) : Math.round(-(den / num) * 100)
}

/** "20260403001000" → "2026-04-03T00:10:00.000Z" */
function parseBet365Time(bc: string): string | null {
  if (!bc || bc.length < 14) return null
  const ts = `${bc.slice(0, 4)}-${bc.slice(4, 6)}-${bc.slice(6, 8)}T${bc.slice(8, 10)}:${bc.slice(10, 12)}:00.000Z`
  return isNaN(Date.parse(ts)) ? null : ts
}

interface FixtureInfo {
  fiId: string
  homeTeam: string
  awayTeam: string
  startTime: string
}

/** Fixture info comes from PA records that have NA + N2 (the team-vs-team
 *  rows). One such PA exists per fixture across the moneyline payload. */
function extractFixtures(records: Bet365Record[]): Map<string, FixtureInfo> {
  const out = new Map<string, FixtureInfo>()
  for (const r of records) {
    if (r.type !== 'PA') continue
    const { FI, NA, N2, BC } = r.fields
    if (!FI || !NA || !N2 || !BC) continue
    if (out.has(FI)) continue
    const startTime = parseBet365Time(BC)
    if (!startTime) continue
    out.set(FI, { fiId: FI, homeTeam: N2.trim(), awayTeam: NA.trim(), startTime })
  }
  return out
}

interface ParsedMarket {
  fiId: string
  type: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

function buildMarkets(
  records: Bet365Record[],
  marketType: 'moneyline' | 'spread' | 'total',
  fixtures: Map<string, FixtureInfo>,
): ParsedMarket[] {
  const byFi = new Map<string, Bet365Record[]>()
  for (const r of records) {
    if (r.type !== 'PA') continue
    const fi = r.fields.FI
    if (!fi || !fixtures.has(fi)) continue
    if (!byFi.has(fi)) byFi.set(fi, [])
    byFi.get(fi)!.push(r)
  }

  const out: ParsedMarket[] = []
  for (const [fiId, pas] of byFi) {
    const fixture = fixtures.get(fiId)!
    let homePrice: number | null = null
    let awayPrice: number | null = null
    let spreadValue: number | null = null
    let totalValue: number | null = null
    let overPrice: number | null = null
    let underPrice: number | null = null

    for (const pa of pas) {
      const { NA, OD, HD } = pa.fields
      if (!NA || !OD) continue
      const price = fractionalToAmerican(OD)
      if (price == null) continue
      const team = NA.trim()

      if (marketType === 'moneyline') {
        if (team === fixture.homeTeam) homePrice = price
        else if (team === fixture.awayTeam) awayPrice = price
      } else if (marketType === 'spread' && HD) {
        const hcap = parseFloat(HD)
        if (isNaN(hcap)) continue
        if (team === fixture.homeTeam) {
          homePrice = price
          // Signed spread from home team's perspective.
          if (spreadValue == null) spreadValue = hcap
        } else if (team === fixture.awayTeam) {
          awayPrice = price
          if (spreadValue == null) spreadValue = -hcap
        }
      } else if (marketType === 'total' && HD) {
        const hdClean = HD.replace(/\s/g, '')
        const prefix = hdClean[0]?.toUpperCase()
        const line = parseFloat(hdClean.slice(1))
        if (isNaN(line)) continue
        if (totalValue == null) totalValue = line
        if (prefix === 'O') overPrice = price
        else if (prefix === 'U') underPrice = price
      }
    }

    out.push({
      fiId, type: marketType,
      homePrice, awayPrice,
      spreadValue, totalValue,
      overPrice, underPrice,
    })
  }
  return out
}

export const bet365Adapter: BookAdapter = {
  slug: 'bet365',
  name: 'Bet365 (Ontario)',
  pollIntervalSec: 7200,  // 2h — cap IPRoyal mobile cost
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    // bet365 is CF-gated and its hash-SPA only fires market XHRs after
    // tab/league clicks. PacketStream gets ERR_EMPTY_RESPONSE on every
    // attempt — Cloudflare apparently blocks the residential pool hard.
    // Try direct from Railway IP instead (same tactic as Caesars v3). Env
    // guard remains for a cheap off-switch.
    if (process.env.BET365_ENABLED === '0') {
      log.info('skipped — BET365_ENABLED=0')
      return { events: [], errors: [] }
    }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      for (const comp of COMPETITIONS) {
        if (signal.aborted) break

        // Strategy: navigate to bet365's NBA grid page and let their JS
        // fire the matchmarketscontentapi requests with the proper
        // x-net-sync-term header + cookies. We intercept the responses via
        // waitForResponse rather than trying to forge our own request.
        const targetUrl = `${BASE}/${comp.pageFragment}`

        // Pre-register response listener for the three market type fetches
        // BEFORE navigating — pages issue these requests during render.
        const captured = new Map<'moneyline' | 'spread' | 'total', { status: number; text: string }>()
        // Diag: also collect every response URL so we can see what bet365's
        // SPA actually fetches once it renders.
        const allResponseUrls: string[] = []
        const responseHandler = async (resp: import('playwright').Response) => {
          const url = resp.url()
          if (url.includes('bet365') || url.includes('365.ca')) {
            allResponseUrls.push(`${resp.status()} ${url.length > 150 ? url.slice(0, 150) + '...' : url}`)
          }
          if (!url.includes('matchmarketscontentapi/markets')) return
          const eMatch = decodeURIComponent(url).match(/[#%23]E(\d+)[#%23]/)
          if (!eMatch) return
          const eId = parseInt(eMatch[1], 10)
          const mt = MARKET_TYPE_IDS.find(m => m.id === eId)
          if (!mt) return
          if (captured.has(mt.type)) return
          try {
            const text = await resp.text()
            captured.set(mt.type, { status: resp.status(), text })
          } catch { /* response stream may have closed */ }
        }
        page.on('response', responseHandler)

        log.info('navigating to comp page', { comp: comp.name, url: targetUrl })
        try {
          // domcontentloaded instead of networkidle — bet365's SPA holds
          // websockets open which keeps networkidle from ever firing.
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        } catch (e: any) {
          log.error('comp page nav failed', { comp: comp.name, message: e?.message ?? String(e) })
          errors.push(`${comp.name} nav: ${e?.message ?? e}`)
          page.off('response', responseHandler)
          continue
        }
        // Long settle so the SPA's hash-router has time to render the
        // league grid and fire the matchmarketscontentapi requests.
        await page.waitForTimeout(15_000)
        page.off('response', responseHandler)

        // Diag: dump the URLs the page actually hit so we can see the real
        // endpoints if matchmarketscontentapi never fires.
        log.info('all bet365 responses seen', {
          comp: comp.name,
          totalSeen: allResponseUrls.length,
          sample: allResponseUrls.slice(0, 30),
          marketsRequested: allResponseUrls.filter(u => u.includes('markets')).length,
        })

        log.info('captured market responses', {
          comp: comp.name,
          types: [...captured.keys()],
          counts: [...captured.entries()].map(([t, v]) => ({ type: t, status: v.status, len: v.text.length })),
        })

        // If the page didn't fire all three, fall back to fetching them
        // from inside the page context (might still 200-empty without sync
        // term, but worth trying once).
        const responses = await Promise.allSettled(
          MARKET_TYPE_IDS.map(async ({ id, type }) => {
            const cap = captured.get(type)
            if (cap) {
              return { type, status: cap.status, text: cap.text, records: parseResponse(cap.text), url: '(captured)' }
            }
            const url = buildUrl(comp, id)
            const result = await page.evaluate(async ({ u, h }) => {
              const r = await fetch(u, { headers: { Accept: '*/*', ...h }, credentials: 'include' })
              const t = await r.text()
              return { status: r.status, text: t }
            }, { u: url, h: API_HEADERS })
            return {
              type,
              status: result.status,
              text: result.text,
              records: parseResponse(result.text),
              url,
            }
          }),
        )

        const recordsByType = new Map<'moneyline' | 'spread' | 'total', Bet365Record[]>()
        const allRecords: Bet365Record[] = []
        for (let i = 0; i < responses.length; i++) {
          const r = responses[i]
          const t = MARKET_TYPE_IDS[i].type
          if (r.status === 'rejected') {
            errors.push(`${comp.name} ${t}: ${r.reason?.message ?? r.reason}`)
            log.error('fetch rejected', { comp: comp.name, type: t, error: r.reason?.message ?? String(r.reason) })
            continue
          }
          const v = r.value
          // Detailed per-fetch diag: HTTP status, body length, record types
          // and counts. Tells us in one log line whether bet365 served us
          // markets or a Cloudflare page.
          const typeCounts: Record<string, number> = {}
          for (const rec of v.records) typeCounts[rec.type] = (typeCounts[rec.type] ?? 0) + 1
          log.info('fetch result', {
            comp: comp.name,
            type: t,
            status: v.status,
            bodyLen: v.text.length,
            recordCount: v.records.length,
            typeCounts,
            firstRecord: v.records[0] ?? null,
            sampleBody: v.text.slice(0, 200),
          })
          if (v.status >= 400) {
            errors.push(`${comp.name} ${t}: HTTP ${v.status}`)
            continue
          }
          recordsByType.set(t, v.records)
          allRecords.push(...v.records)
        }

        if (allRecords.length === 0) {
          log.warn('no records — skipping comp', { comp: comp.name })
          continue
        }

        const fixtures = extractFixtures(allRecords)
        log.info('fixtures extracted', { comp: comp.name, fixtureCount: fixtures.size })
        if (fixtures.size === 0) {
          // Dump a sample of PA records to see why fixture extraction
          // failed (typically NA/N2/BC fields missing).
          const paSample = allRecords.filter(r => r.type === 'PA').slice(0, 3)
          log.warn('zero fixtures — PA sample', { sample: paSample })
        }

        // Per-event bucket: { event, gameMarkets, props }
        const bucket = new Map<string, { event: NormalizedEvent; gameMarkets: GameMarket[] }>()
        for (const fixture of fixtures.values()) {
          bucket.set(fixture.fiId, {
            event: {
              externalId: fixture.fiId,
              homeTeam: fixture.homeTeam,
              awayTeam: fixture.awayTeam,
              startTime: fixture.startTime,
              leagueSlug: comp.leagueSlug,
              sport: comp.sport,
            },
            gameMarkets: [],
          })
        }

        for (const [type, records] of recordsByType) {
          const parsed = buildMarkets(records, type, fixtures)
          for (const m of parsed) {
            const b = bucket.get(m.fiId)
            if (!b) continue
            if (type === 'moneyline') {
              b.gameMarkets.push({
                marketType: 'moneyline',
                homePrice: m.homePrice, awayPrice: m.awayPrice, drawPrice: null,
                spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
              })
            } else if (type === 'spread') {
              b.gameMarkets.push({
                marketType: 'spread',
                homePrice: m.homePrice, awayPrice: m.awayPrice, drawPrice: null,
                spreadValue: m.spreadValue,
                totalValue: null, overPrice: null, underPrice: null,
              })
            } else if (type === 'total') {
              b.gameMarkets.push({
                marketType: 'total',
                homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
                totalValue: m.totalValue,
                overPrice: m.overPrice, underPrice: m.underPrice,
              })
            }
          }
        }

        for (const b of bucket.values()) {
          if (b.gameMarkets.length > 0) {
            scraped.push({ event: b.event, gameMarkets: b.gameMarkets, props: [] })
          }
        }

        log.debug(`${comp.name}: ${fixtures.size} fixtures`)
      }

      return { events: scraped, errors }
    }, { useProxy: 'mobile', rotateSession: true })
    // Residential proxy (IPRoyal) restored: PacketStream DC IPs were
    // blocked but Starlink residential exits clear CF. Also rotate
    // sessions so repeat-request heuristics don't flag us.
  },
}
