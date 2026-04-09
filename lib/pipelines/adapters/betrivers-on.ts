// ─────────────────────────────────────────────────────────────────────────────
// BetRivers Ontario adapter
//
// Platform:  Kambi sportsbook (client ID: rsicaon)
// Base URL:  https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon
// Auth:      None — fully public JSON API
//
// Uses withBrowser (Playwright) so requests go through Chromium — same as all
// other working adapters. pipeFetch (Node.js fetch) hangs indefinitely on
// Kambi endpoints that don't respond quickly.
//
// Data flow:
//   1. visit SEED_URL to get a Chromium session
//   2. fetchJson /listView/{sport}/{league}.json for each target league
//        → events with one embedded betOffer (the main market)
//   Markets are extracted directly from listView betOffers — no per-event calls.
//
// Odds format:
//   outcome.oddsAmerican  = string e.g. "-114", "107"
//   outcome.line          = integer × 1000  e.g. 6000 = +6, 249000 = 249
//
// betOfferType IDs:  2=moneyline  1=spread  6=total
// outcome.type:      OT_ONE=home  OT_TWO=away  OT_CROSS=draw  OT_OVER  OT_UNDER
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

const BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon'
const PARAMS = 'lang=en_CA&market=CA&client_id=2&channel_id=1&ncid=1'
const SEED_URL = `${BASE}/listView/basketball/nba.json?${PARAMS}`

const API_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}

// Confirmed working on rsicaon
const TARGETS: Array<{ sport: string; league: string; slug: string }> = [
  { sport: 'basketball',        league: 'nba',       slug: 'nba' },
  { sport: 'basketball',        league: 'euroleague', slug: 'euroleague' },
  { sport: 'basketball',        league: 'ncaab',      slug: 'ncaab' },
  { sport: 'ice_hockey',        league: 'nhl',        slug: 'nhl' },
  { sport: 'ice_hockey',        league: 'ahl',        slug: 'ahl' },
  { sport: 'american_football', league: 'nfl',        slug: 'nfl' },
  { sport: 'american_football', league: 'cfl',        slug: 'cfl' },
  { sport: 'baseball',          league: 'mlb',        slug: 'mlb' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAmericanOdds(s: string): number {
  return parseInt(s.replace('+', ''), 10)
}

function getSide(type: string): CanonicalOutcome['side'] {
  switch (type) {
    case 'OT_ONE':   return 'home'
    case 'OT_TWO':   return 'away'
    case 'OT_CROSS': return 'draw'
    case 'OT_OVER':  return 'over'
    case 'OT_UNDER': return 'under'
    default:         return 'home'
  }
}

function extractMarkets(item: any, eventId: string, leagueSlug: string): CanonicalMarket[] {
  const betOffers: any[] = item.betOffers ?? []
  const now = new Date().toISOString()
  const out: CanonicalMarket[] = []

  const openOutcomes = (bo: any): any[] =>
    (bo.outcomes ?? []).filter((o: any) => o.status === 'OPEN')

  const moneylines = betOffers.filter(
    (bo: any) => bo.betOfferType?.id === 2 && bo.criterion?.lifetime === 'FULL_TIME_OVERTIME'
  )
  const allSpreads = betOffers.filter(
    (bo: any) => bo.betOfferType?.id === 1 && bo.criterion?.lifetime === 'FULL_TIME_OVERTIME'
  )
  const spreads = allSpreads.filter((bo: any) => (bo.tags ?? []).includes('MAIN_LINE'))
    .concat(allSpreads).slice(0, 1)
  const totals = betOffers.filter(
    (bo: any) =>
      bo.betOfferType?.id === 6 &&
      bo.criterion?.lifetime === 'FULL_TIME_OVERTIME' &&
      !(bo.criterion?.label ?? '').toLowerCase().includes('team') &&
      !(bo.criterion?.label ?? '').toLowerCase().includes('player')
  )

  // Moneyline
  const ml = moneylines[0]
  if (ml) {
    const outcomes: CanonicalOutcome[] = []
    for (const o of openOutcomes(ml)) {
      if (!['OT_ONE', 'OT_TWO', 'OT_CROSS'].includes(o.type)) continue
      const price = parseAmericanOdds(o.oddsAmerican)
      if (isNaN(price)) continue
      outcomes.push({ side: getSide(o.type), label: o.label, price, impliedProb: americanToImplied(price) })
    }
    if (outcomes.length >= 2) {
      out.push({ eventId, marketType: 'moneyline', shape: detectMarketShape(leagueSlug, 'moneyline'), outcomes, lineValue: null, sourceSlug: 'betrivers_on', capturedAt: now })
    }
  }

  // Spread
  const sp = spreads[0]
  if (sp) {
    const outcomes: CanonicalOutcome[] = []
    let lineValue: number | null = null
    for (const o of openOutcomes(sp)) {
      if (!['OT_ONE', 'OT_TWO'].includes(o.type)) continue
      const price = parseAmericanOdds(o.oddsAmerican)
      if (isNaN(price)) continue
      const line = (o.line ?? 0) / 1000
      if (lineValue === null) lineValue = Math.abs(line)
      outcomes.push({ side: getSide(o.type), label: `${o.label} ${line >= 0 ? '+' : ''}${line}`, price, impliedProb: americanToImplied(price) })
    }
    if (outcomes.length >= 2 && lineValue !== null) {
      out.push({ eventId, marketType: 'spread', shape: '2way', outcomes, lineValue, sourceSlug: 'betrivers_on', capturedAt: now })
    }
  }

  // Total
  const tot = totals[0]
  if (tot) {
    const outcomes: CanonicalOutcome[] = []
    let lineValue: number | null = null
    for (const o of openOutcomes(tot)) {
      if (!['OT_OVER', 'OT_UNDER'].includes(o.type)) continue
      const price = parseAmericanOdds(o.oddsAmerican)
      if (isNaN(price)) continue
      const line = (o.line ?? 0) / 1000
      if (lineValue === null) lineValue = line
      outcomes.push({ side: getSide(o.type), label: `${o.type === 'OT_OVER' ? 'Over' : 'Under'} ${line}`, price, impliedProb: americanToImplied(price) })
    }
    if (outcomes.length >= 2 && lineValue !== null) {
      out.push({ eventId, marketType: 'total', shape: '2way', outcomes, lineValue, sourceSlug: 'betrivers_on', capturedAt: now })
    }
  }

  return out
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const betRiversOnAdapter: SourceAdapter = {
  slug: 'betrivers_on',
  ingestionMethod: 'direct-api (Kambi rsicaon)',

  async fetchEvents(): Promise<FetchEventsResult> {
    return withBrowser(async ({ visit, fetchJson }) => {
      const start = Date.now()
      await visit(SEED_URL)

      const allEvents: CanonicalEvent[] = []
      const allMarkets: CanonicalMarket[] = []
      const rawPayloads: unknown[] = []
      const errors: string[] = []

      // Fetch all target leagues in parallel inside Chromium
      const listViews = await Promise.allSettled(
        TARGETS.map(async (t) => {
          const url = `${BASE}/listView/${t.sport}/${t.league}.json?${PARAMS}`
          const data = await fetchJson(url, API_HEADERS)
          return { target: t, data }
        })
      )

      for (const res of listViews) {
        if (res.status === 'rejected') {
          errors.push(`listView ${res.reason?.message ?? res.reason}`)
          continue
        }
        const { target, data } = res.value
        rawPayloads.push(data)
        const items: any[] = data.events ?? []
        let count = 0
        for (const item of items) {
          const ev = item.event
          if (!ev || ev.state === 'STARTED' || ev.state === 'FINISHED') continue
          if (!ev.homeName || !ev.awayName) continue
          allEvents.push(normalizeEvent({
            externalId: String(ev.id),
            homeTeam:   ev.homeName,
            awayTeam:   ev.awayName,
            startTime:  ev.start,
            leagueSlug: target.slug,
            sourceSlug: 'betrivers_on',
          }))
          allMarkets.push(...extractMarkets(item, String(ev.id), target.slug))
          count++
        }
        console.log(`[betrivers] ${target.slug}: ${items.length} events, ${count} processed`)
      }

      console.log(`[betrivers] fetchEvents: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`)
      if (errors.length) console.error('[betrivers] errors:', errors)

      return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
    })
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    return withBrowser(async ({ visit, fetchJson }) => {
      await visit(SEED_URL)
      const url = `${BASE}/betoffer/event/${eventId}.json?lang=en_CA&includeParticipants=true`
      const data = await fetchJson(url, API_HEADERS)
      const markets = extractMarkets(data, eventId, '')
      return { raw: data, markets }
    })
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const data = await withBrowser(async ({ visit, fetchJson }) => {
        await visit(SEED_URL)
        return fetchJson(SEED_URL, API_HEADERS)
      })
      const count = (data.events ?? []).length
      if (count === 0) throw new Error('No NBA events returned')
      const latencyMs = Date.now() - start
      return { healthy: true, latencyMs, message: `ok — ${count} NBA events (${latencyMs}ms)` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
