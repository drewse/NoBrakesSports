// ─────────────────────────────────────────────────────────────────────────────
// BetRivers Ontario adapter
//
// Platform:  Kambi sportsbook (client ID: rsicaon)
// Base URL:  https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon
// Auth:      None — fully public JSON API
//
// No Playwright needed — standard JSON over HTTPS, no bot protection.
//
// Data flow:
//   1. GET /listView/{sport}/{league}.json for each target league
//        → event IDs + team names + start times
//   2. GET /betoffer/event/{id}.json for each event
//        → full market set; filter to main moneyline, spread, total
//
// Odds format:
//   outcome.oddsAmerican  = string, e.g. "-114", "107" (no + prefix always)
//   outcome.line          = integer × 1000, e.g. 6000 = +6, 249000 = 249
//
// betOfferType IDs:
//   2 = Match (moneyline)   1 = Handicap (spread)   6 = Over/Under (total)
//
// outcome.type values:
//   OT_ONE = home   OT_TWO = away   OT_CROSS = draw
//   OT_OVER = over  OT_UNDER = under
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
import { pipeFetch } from '../proxy-fetch'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon'
const PARAMS = 'lang=en_CA&market=CA&client_id=2&channel_id=1&ncid=1'

// Target leagues — [sport termKey, league termKey, our DB slug]
// All confirmed present in rsicaon group.json
const TARGETS: Array<{ sport: string; league: string; slug: string }> = [
  // Basketball
  { sport: 'basketball',        league: 'nba',                    slug: 'nba' },
  { sport: 'basketball',        league: 'euroleague',              slug: 'euroleague' },
  { sport: 'basketball',        league: 'ncaab',                   slug: 'ncaab' },
  // Hockey
  { sport: 'ice_hockey',        league: 'nhl',                     slug: 'nhl' },
  { sport: 'ice_hockey',        league: 'ahl',                     slug: 'ahl' },
  { sport: 'ice_hockey',        league: 'shl',                     slug: 'shl' },
  { sport: 'ice_hockey',        league: 'pwhl',                    slug: 'pwhl' },
  // American Football
  { sport: 'american_football', league: 'nfl',                     slug: 'nfl' },
  { sport: 'american_football', league: 'ncaaf',                   slug: 'ncaaf' },
  { sport: 'american_football', league: 'cfl',                     slug: 'cfl' },
  // Baseball
  { sport: 'baseball',          league: 'mlb',                     slug: 'mlb' },
  // Soccer — confirmed present in group.json, using Kambi termKeys
  { sport: 'football',          league: 'english_premier_league',  slug: 'epl' },
  { sport: 'football',          league: 'la_liga',                 slug: 'laliga' },
  { sport: 'football',          league: 'bundesliga',              slug: 'bundesliga' },
  { sport: 'football',          league: 'serie_a',                 slug: 'seria_a' },
  { sport: 'football',          league: 'ligue_1',                 slug: 'ligue_one' },
  { sport: 'football',          league: 'champions_league',        slug: 'ucl' },
  { sport: 'football',          league: 'europa_league',           slug: 'uel' },
  { sport: 'football',          league: 'conference_league',       slug: 'uecl' },
  { sport: 'football',          league: 'eredivisie',              slug: 'eredivisie' },
  { sport: 'football',          league: 'primeira_liga',           slug: 'liga_portugal' },
  { sport: 'football',          league: 'scottish_premiership',    slug: 'spl' },
  { sport: 'football',          league: 'mls',                     slug: 'mls' },
  { sport: 'football',          league: 'brasileirao_serie_a',     slug: 'brazil_serie_a' },
  { sport: 'football',          league: 'copa_libertadores',       slug: 'copa_libertadores' },
  { sport: 'football',          league: 'a-league',                slug: 'australia_aleague' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiGet(path: string, timeoutMs = 8000): Promise<any> {
  const url = `${BASE}${path}`
  const fetchPromise = pipeFetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  })
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms: ${url}`)), timeoutMs)
  )
  const res = await Promise.race([fetchPromise, timeoutPromise])
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

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

// ── Market extraction from a full betoffer/event response ─────────────────────

function extractMarkets(
  data: any,
  eventId: string,
  leagueSlug: string
): CanonicalMarket[] {
  const betOffers: any[] = data.betOffers ?? []
  const now = new Date().toISOString()
  const out: CanonicalMarket[] = []

  // Helper: pick open outcomes only
  const openOutcomes = (bo: any): any[] =>
    (bo.outcomes ?? []).filter((o: any) => o.status === 'OPEN')

  // Identify main full-game markets:
  // - Moneyline: betOfferType.id=2, lifetime FULL_TIME_OVERTIME
  // - Spread:    betOfferType.id=1, tag MAIN_LINE
  // - Total:     betOfferType.id=6, lifetime FULL_TIME_OVERTIME, no "Team" in criterion label

  const moneylines = betOffers.filter(
    (bo: any) =>
      bo.betOfferType?.id === 2 &&
      bo.criterion?.lifetime === 'FULL_TIME_OVERTIME'
  )
  // Spread: prefer MAIN_LINE tag; fall back to first FULL_TIME_OVERTIME handicap
  const allSpreads = betOffers.filter(
    (bo: any) =>
      bo.betOfferType?.id === 1 &&
      bo.criterion?.lifetime === 'FULL_TIME_OVERTIME'
  )
  const spreads = allSpreads.filter((bo: any) => (bo.tags ?? []).includes('MAIN_LINE'))
    .concat(allSpreads).slice(0, 1) // pick MAIN_LINE if exists, else first
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
      out.push({
        eventId,
        marketType: 'moneyline',
        shape: detectMarketShape(leagueSlug, 'moneyline'),
        outcomes,
        lineValue: null,
        sourceSlug: 'betrivers_on',
        capturedAt: now,
      })
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
      const sign = line >= 0 ? '+' : ''
      outcomes.push({ side: getSide(o.type), label: `${o.label} ${sign}${line}`, price, impliedProb: americanToImplied(price) })
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
    const start = Date.now()
    const allEvents: CanonicalEvent[] = []
    const allMarkets: CanonicalMarket[] = []
    const rawPayloads: unknown[] = []
    const errors: string[] = []

    // Step 1: fetch listView for all target leagues in parallel
    const listViews = await Promise.allSettled(
      TARGETS.map(async (t) => {
        const data = await apiGet(`/listView/${t.sport}/${t.league}.json?${PARAMS}`)
        return { target: t, data }
      })
    )

    // Extract events + markets directly from listView — each item has betOffers embedded.
    // No per-event API call needed: listView returns the main market per event already.
    // This keeps total HTTP requests = number of leagues (≤ 25), well within timeout.
    for (const res of listViews) {
      if (res.status === 'rejected') {
        errors.push(`listView fetch: ${res.reason?.message ?? res.reason}`)
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

        const canonical = normalizeEvent({
          externalId: String(ev.id),
          homeTeam:   ev.homeName,
          awayTeam:   ev.awayName,
          startTime:  ev.start,
          leagueSlug: target.slug,
          sourceSlug: 'betrivers_on',
        })
        allEvents.push(canonical)

        // Extract markets from the embedded betOffers in this listView item
        const markets = extractMarkets(item, String(ev.id), target.slug)
        allMarkets.push(...markets)
        count++
      }
      console.log(`[betrivers] ${target.slug}: ${items.length} events, ${count} processed`)
    }

    console.log(`[betrivers] fetchEvents: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`)
    if (errors.length) console.error('[betrivers] errors:', errors.slice(0, 5))

    return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    const data = await apiGet(`/betoffer/event/${eventId}.json?lang=en_CA&includeParticipants=true`)
    const markets = extractMarkets(data, eventId, '')
    return { raw: data, markets }
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const data = await apiGet(`/listView/basketball/nba.json?${PARAMS}`)
      const count = (data.events ?? []).length
      if (count === 0) throw new Error('No NBA events returned')
      const latencyMs = Date.now() - start
      return { healthy: true, latencyMs, message: `ok — ${count} NBA events (${latencyMs}ms)` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
