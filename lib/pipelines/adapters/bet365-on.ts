// ─────────────────────────────────────────────────────────────────────────────
// Bet365 Ontario adapter
//
// Endpoint discovery: 2026-04-01
//   Markets API: https://www.on.bet365.ca/matchmarketscontentapi/markets
//   Auth:        None (public API) — protected by Cloudflare Bot Management
//   Origin:      https://www.on.bet365.ca
//
// Uses Playwright (real Chromium) to bypass Cloudflare TLS fingerprinting.
//
// Response format: custom pipe-delimited text protocol
//   Records separated by '|', fields within a record by ';'
//   Record types: F (filler), EV (event), MG (market group), MA (market), PA (participant/selection)
//   Field format: KEY=VALUE
//
// Key PA fields:
//   FI  = fixture ID (unique per event — used as externalId)
//   NA  = away team name (or "Over"/"Under" for totals)
//   N2  = home team name
//   BC  = start time in YYYYMMDDHHmmss UTC
//   HD  = handicap ("+2.5" for spread, "O235.5"/"U235.5" for totals)
//   OD  = fractional odds (e.g. "10/11", "5/4", "9/5")
//
// Market type IDs (E value in pd param):
//   960  = Moneyline
//   1453 = Spread
//   1454 = Total
//
// To add a new competition:
//   1. Open DevTools on www.on.bet365.ca, navigate to the sport's page
//   2. Find a request to matchmarketscontentapi/markets
//   3. Extract lid, cid, cgid, ctid from query params
//   4. Decode the pd param — extract B, C, D values
//   5. Add an entry to COMPETITIONS below
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SourceAdapter,
  FetchEventsResult,
  FetchMarketsResult,
  HealthCheckResult,
  CanonicalEvent,
  CanonicalMarket,
  CanonicalOutcome,
} from '../types'
import { normalizeEvent, americanToImplied, detectMarketShape } from '../normalize'
import { withBrowser } from '../browser-fetch'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = 'https://www.on.bet365.ca'
const SEED_URL = `${BASE}/#/IP/B18`  // NBA page — sets Cloudflare cookies

type Bet365Competition = {
  name: string
  leagueSlug: string
  /** Sport/league ID — lid query param */
  lid: number
  /** Competition ID — cid query param */
  cid: number
  /** Competition group ID — cgid query param */
  cgid: number
  /** Competition type ID — ctid query param */
  ctid: number
  /** B value in the pd path param */
  pdB: number
  /** C value in the pd path param */
  pdC: number
  /** D value in the pd path param */
  pdD: number
}

// NBA confirmed 2026-04-01 from DevTools:
//   lid=32 cid=272 cgid=2 ctid=272 pd=#AC#B18#C20604387#D48#E{mktId}#F10#
const COMPETITIONS: Bet365Competition[] = [
  {
    name: 'NBA',
    leagueSlug: 'nba',
    lid: 32, cid: 272, cgid: 2, ctid: 272,
    pdB: 18, pdC: 20604387, pdD: 48,
  },
  // TODO: Add NHL, MLB, NFL, Soccer — extract IDs from DevTools on each sport page
]

const MARKET_TYPES: Array<{ id: number; type: 'moneyline' | 'spread' | 'total' }> = [
  { id: 960,  type: 'moneyline' },
  { id: 1453, type: 'spread' },
  { id: 1454, type: 'total' },
]

const API_HEADERS = {
  Origin: BASE,
  Referer: `${BASE}/`,
}

// ── URL builder ───────────────────────────────────────────────────────────────

function buildUrl(comp: Bet365Competition, marketTypeId: number): string {
  const pdRaw = `#AC#B${comp.pdB}#C${comp.pdC}#D${comp.pdD}#E${marketTypeId}#F10#`
  const pd = encodeURIComponent(pdRaw)
  return `${BASE}/matchmarketscontentapi/markets?lid=${comp.lid}&zid=0&pd=${pd}&cid=${comp.cid}&cgid=${comp.cgid}&ctid=${comp.ctid}`
}

// ── Response parser ───────────────────────────────────────────────────────────

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

// ── Odds / time helpers ───────────────────────────────────────────────────────

/**
 * Convert fractional odds to American odds.
 *   10/11 → -110 (fraction < 1 → negative)
 *   5/4   → +125 (fraction ≥ 1 → positive)
 */
function fractionalToAmerican(frac: string): number {
  const slash = frac.indexOf('/')
  if (slash === -1) throw new Error(`Invalid fractional: ${frac}`)
  const num = Number(frac.slice(0, slash))
  const den = Number(frac.slice(slash + 1))
  if (!isFinite(num) || !isFinite(den) || den === 0) throw new Error(`Invalid fractional: ${frac}`)
  const fraction = num / den
  return fraction >= 1 ? Math.round(fraction * 100) : Math.round(-(den / num) * 100)
}

/**
 * Parse bet365 start time string (YYYYMMDDHHmmss) to ISO 8601 UTC.
 * Example: "20260403001000" → "2026-04-03T00:10:00.000Z"
 */
function parseBet365Time(bc: string): string | null {
  if (!bc || bc.length < 14) return null
  const ts = `${bc.slice(0, 4)}-${bc.slice(4, 6)}-${bc.slice(6, 8)}T${bc.slice(8, 10)}:${bc.slice(10, 12)}:00.000Z`
  return isNaN(Date.parse(ts)) ? null : ts
}

// ── Fixture extraction ────────────────────────────────────────────────────────

type FixtureInfo = {
  fiId: string
  homeTeam: string   // N2 field in PA record
  awayTeam: string   // NA field in PA record
  startTime: string
}

/**
 * Extract fixture (event) info from PA records.
 * bet365 convention: NA = away team, N2 = home team.
 * Uses the first PA record per fixture that has both NA and N2.
 */
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

// ── Market builder ────────────────────────────────────────────────────────────

function buildMarketsFromRecords(
  records: Bet365Record[],
  marketType: 'moneyline' | 'spread' | 'total',
  fixtures: Map<string, FixtureInfo>,
  leagueSlug: string
): CanonicalMarket[] {
  // Group PA records by fixture ID
  const byFi = new Map<string, Bet365Record[]>()
  for (const r of records) {
    if (r.type !== 'PA') continue
    const { FI } = r.fields
    if (!FI || !fixtures.has(FI)) continue
    if (!byFi.has(FI)) byFi.set(FI, [])
    byFi.get(FI)!.push(r)
  }

  const markets: CanonicalMarket[] = []

  for (const [fiId, pas] of byFi) {
    const fixture = fixtures.get(fiId)!
    const outcomes: CanonicalOutcome[] = []
    let lineValue: number | null = null

    for (const pa of pas) {
      const { NA, OD, HD } = pa.fields
      if (!NA || !OD) continue

      let price: number
      try { price = fractionalToAmerican(OD) } catch { continue }

      const team = NA.trim()
      const impliedProb = americanToImplied(price)

      if (marketType === 'moneyline') {
        const side = team === fixture.homeTeam ? 'home' : 'away'
        outcomes.push({ side, label: team, price, impliedProb })

      } else if (marketType === 'spread' && HD) {
        const hcap = parseFloat(HD)
        if (isNaN(hcap)) continue
        if (lineValue === null) lineValue = Math.abs(hcap)
        const side = team === fixture.homeTeam ? 'home' : 'away'
        const sign = hcap > 0 ? '+' : ''
        outcomes.push({ side, label: `${team} ${sign}${hcap}`, price, impliedProb })

      } else if (marketType === 'total' && HD) {
        // HD format: "O235.5" or "U235.5" (possibly with spaces)
        const hdClean = HD.replace(/\s/g, '')
        const prefix = hdClean[0]?.toUpperCase()
        if (prefix !== 'O' && prefix !== 'U') continue
        const line = parseFloat(hdClean.slice(1))
        if (isNaN(line)) continue
        if (lineValue === null) lineValue = line
        const side = prefix === 'O' ? 'over' : 'under'
        outcomes.push({ side, label: `${prefix === 'O' ? 'Over' : 'Under'} ${line}`, price, impliedProb })
      }
    }

    if (outcomes.length === 0) continue
    if (marketType !== 'moneyline' && lineValue === null) continue

    markets.push({
      eventId: fiId,
      marketType,
      shape: detectMarketShape(leagueSlug, marketType),
      outcomes,
      lineValue,
      sourceSlug: 'bet365',
      capturedAt: new Date().toISOString(),
    })
  }

  return markets
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const bet365OnAdapter: SourceAdapter = {
  slug: 'bet365',
  ingestionMethod: 'playwright + pipe-protocol',

  async fetchEvents(): Promise<FetchEventsResult> {
    const start = Date.now()

    return withBrowser(async ({ visit, fetchText }) => {
      await visit(SEED_URL)

      const allEvents: CanonicalEvent[] = []
      const allMarkets: CanonicalMarket[] = []
      const rawPayloads: unknown[] = []
      const errors: string[] = []

      for (const comp of COMPETITIONS) {
        // Fetch all 3 market types concurrently per competition
        const results = await Promise.allSettled(
          MARKET_TYPES.map(async ({ id, type }) => {
            const url = buildUrl(comp, id)
            const text = await fetchText(url, API_HEADERS)
            return { type, text, records: parseResponse(text) }
          })
        )

        // Collect all records to extract fixture info (fixtures appear across all market types)
        const allRecords: Bet365Record[] = []
        const recordsByType = new Map<string, Bet365Record[]>()

        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          const mktType = MARKET_TYPES[i].type
          if (result.status === 'rejected') {
            errors.push(`${comp.name} ${mktType}: ${result.reason?.message ?? result.reason}`)
            continue
          }
          rawPayloads.push({ comp: comp.name, marketType: mktType, raw: result.value.text.slice(0, 1000) })
          allRecords.push(...result.value.records)
          recordsByType.set(mktType, result.value.records)
        }

        if (allRecords.length === 0) continue

        // Extract fixture info from all PA records combined
        const fixtures = extractFixtures(allRecords)

        // Build CanonicalEvent for each fixture
        for (const fixture of fixtures.values()) {
          allEvents.push(normalizeEvent({
            externalId: fixture.fiId,
            homeTeam: fixture.homeTeam,
            awayTeam: fixture.awayTeam,
            startTime: fixture.startTime,
            leagueSlug: comp.leagueSlug,
            sourceSlug: 'bet365',
          }))
        }

        // Build CanonicalMarkets per market type
        for (const [type, records] of recordsByType) {
          const markets = buildMarketsFromRecords(
            records,
            type as 'moneyline' | 'spread' | 'total',
            fixtures,
            comp.leagueSlug
          )
          allMarkets.push(...markets)
        }

        console.log(
          `[bet365] ${comp.name}: ${fixtures.size} fixtures, ${recordsByType.get('moneyline')?.filter(r => r.type === 'PA').length ?? 0} ML / ${recordsByType.get('spread')?.filter(r => r.type === 'PA').length ?? 0} spread / ${recordsByType.get('total')?.filter(r => r.type === 'PA').length ?? 0} total PA records`
        )
      }

      console.log(
        `[bet365] fetchEvents done: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`
      )
      if (errors.length) console.error('[bet365] errors:', errors)

      return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
    })
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    return withBrowser(async ({ visit, fetchText }) => {
      await visit(SEED_URL)
      const allMarkets: CanonicalMarket[] = []

      for (const comp of COMPETITIONS) {
        const results = await Promise.allSettled(
          MARKET_TYPES.map(async ({ id, type }) => {
            const url = buildUrl(comp, id)
            const text = await fetchText(url, API_HEADERS)
            return { type, records: parseResponse(text) }
          })
        )

        const allRecords: Bet365Record[] = []
        const recordsByType = new Map<string, Bet365Record[]>()
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          if (result.status === 'fulfilled') {
            allRecords.push(...result.value.records)
            recordsByType.set(MARKET_TYPES[i].type, result.value.records)
          }
        }

        const fixtures = extractFixtures(allRecords)
        if (!fixtures.has(eventId)) continue

        for (const [type, records] of recordsByType) {
          const markets = buildMarketsFromRecords(
            records,
            type as 'moneyline' | 'spread' | 'total',
            fixtures,
            comp.leagueSlug
          )
          allMarkets.push(...markets.filter(m => m.eventId === eventId))
        }

        if (allMarkets.length > 0) break
      }

      return { raw: null, markets: allMarkets }
    })
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await withBrowser(async ({ visit, fetchText }) => {
        await visit(SEED_URL)
        const url = buildUrl(COMPETITIONS[0], MARKET_TYPES[0].id)
        const text = await fetchText(url, API_HEADERS)
        if (!text || text.length < 10) throw new Error('Empty response')
      })
      const latencyMs = Date.now() - start
      return { healthy: true, latencyMs, message: `ok (${latencyMs}ms)` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
