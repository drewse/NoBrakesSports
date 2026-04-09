// ─────────────────────────────────────────────────────────────────────────────
// BetRivers Ontario adapter
//
// Platform:  Kambi sportsbook (client ID: rsicaon)
// Base URL:  https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon
// Auth:      None — fully public JSON API, no bot protection
//
// Uses pipeFetch (direct Node.js fetch) — no Playwright needed.
// Markets extracted directly from listView betOffers, no per-event calls.
//
// Safety: requests run in a pool of MAX_CONCURRENT concurrent fetches.
// Each request carries its own AbortController with a 12s timeout.
// The outer ingest.ts 280s timeout provides the hard wall.
//
// betOfferType IDs:  2=moneyline  1=spread  6=total
// outcome.type:      OT_ONE=home  OT_TWO=away  OT_CROSS=draw  OT_OVER  OT_UNDER
// outcome.oddsAmerican = string e.g. "-114", "107"
// outcome.line = integer × 1000, e.g. 6000 = +6 pts
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

const BASE   = 'https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon'
const PARAMS = 'lang=en_CA&market=CA&client_id=2&channel_id=1&ncid=1'
const REQUEST_TIMEOUT_MS  = 12_000  // per-request abort
const MAX_CONCURRENT      = 3       // parallel listView requests

const HEADERS: Record<string, string> = {
  Accept: 'application/json',
}

// All confirmed 200 on rsicaon
const TARGETS: Array<{ sport: string; league: string; slug: string }> = [
  { sport: 'basketball',        league: 'nba',        slug: 'nba'        },
  { sport: 'basketball',        league: 'euroleague',  slug: 'euroleague' },
  { sport: 'ice_hockey',        league: 'nhl',         slug: 'nhl'        },
  { sport: 'ice_hockey',        league: 'ahl',         slug: 'ahl'        },
  { sport: 'american_football', league: 'nfl',         slug: 'nfl'        },
  { sport: 'american_football', league: 'cfl',         slug: 'cfl'        },
  { sport: 'baseball',          league: 'mlb',         slug: 'mlb'        },
]

async function kambiGet(path: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await pipeFetch(`${BASE}${path}`, { headers: HEADERS, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${BASE}${path}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/** Run tasks in a pool of max `concurrency` concurrent promises. */
async function poolAll<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []
  let idx = 0

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() }
      } catch (e: any) {
        results[i] = { status: 'rejected', reason: e }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

function parseOdds(s: string): number { return parseInt(s.replace('+', ''), 10) }

function getSide(type: string): CanonicalOutcome['side'] {
  if (type === 'OT_ONE')   return 'home'
  if (type === 'OT_TWO')   return 'away'
  if (type === 'OT_CROSS') return 'draw'
  if (type === 'OT_OVER')  return 'over'
  if (type === 'OT_UNDER') return 'under'
  return 'home'
}

function extractMarkets(item: any, eventId: string, leagueSlug: string): CanonicalMarket[] {
  const betOffers: any[] = item.betOffers ?? []
  const now = new Date().toISOString()
  const out: CanonicalMarket[] = []
  const open = (bo: any) => (bo.outcomes ?? []).filter((o: any) => o.status === 'OPEN')

  const ml    = betOffers.find((bo: any) => bo.betOfferType?.id === 2 && bo.criterion?.lifetime === 'FULL_TIME_OVERTIME')
  const allSp = betOffers.filter((bo: any) => bo.betOfferType?.id === 1 && bo.criterion?.lifetime === 'FULL_TIME_OVERTIME')
  const sp    = allSp.find((bo: any) => (bo.tags ?? []).includes('MAIN_LINE')) ?? allSp[0]
  const tot   = betOffers.find((bo: any) =>
    bo.betOfferType?.id === 6 &&
    bo.criterion?.lifetime === 'FULL_TIME_OVERTIME' &&
    !(bo.criterion?.label ?? '').toLowerCase().includes('team')
  )

  if (ml) {
    const outcomes = open(ml)
      .filter((o: any) => ['OT_ONE', 'OT_TWO', 'OT_CROSS'].includes(o.type))
      .map((o: any) => {
        const p = parseOdds(o.oddsAmerican)
        return isNaN(p) ? null : { side: getSide(o.type), label: o.label, price: p, impliedProb: americanToImplied(p) }
      })
      .filter(Boolean) as CanonicalOutcome[]
    if (outcomes.length >= 2) {
      out.push({ eventId, marketType: 'moneyline', shape: detectMarketShape(leagueSlug, 'moneyline'), outcomes, lineValue: null, sourceSlug: 'betrivers_on', capturedAt: now })
    }
  }

  if (sp) {
    const outcomes: CanonicalOutcome[] = []
    let lineValue: number | null = null
    for (const o of open(sp).filter((o: any) => ['OT_ONE', 'OT_TWO'].includes(o.type))) {
      const p = parseOdds(o.oddsAmerican)
      if (isNaN(p)) continue
      const line = (o.line ?? 0) / 1000
      if (lineValue === null) lineValue = Math.abs(line)
      outcomes.push({ side: getSide(o.type), label: `${o.label} ${line >= 0 ? '+' : ''}${line}`, price: p, impliedProb: americanToImplied(p) })
    }
    if (outcomes.length >= 2 && lineValue !== null) {
      out.push({ eventId, marketType: 'spread', shape: '2way', outcomes, lineValue, sourceSlug: 'betrivers_on', capturedAt: now })
    }
  }

  if (tot) {
    const outcomes: CanonicalOutcome[] = []
    let lineValue: number | null = null
    for (const o of open(tot).filter((o: any) => ['OT_OVER', 'OT_UNDER'].includes(o.type))) {
      const p = parseOdds(o.oddsAmerican)
      if (isNaN(p)) continue
      const line = (o.line ?? 0) / 1000
      if (lineValue === null) lineValue = line
      outcomes.push({ side: getSide(o.type), label: `${o.type === 'OT_OVER' ? 'Over' : 'Under'} ${line}`, price: p, impliedProb: americanToImplied(p) })
    }
    if (outcomes.length >= 2 && lineValue !== null) {
      out.push({ eventId, marketType: 'total', shape: '2way', outcomes, lineValue, sourceSlug: 'betrivers_on', capturedAt: now })
    }
  }

  return out
}

export const betRiversOnAdapter: SourceAdapter = {
  slug: 'betrivers_on',
  ingestionMethod: 'direct-api (Kambi rsicaon)',

  async fetchEvents(): Promise<FetchEventsResult> {
    const start = Date.now()
    const allEvents: CanonicalEvent[] = []
    const allMarkets: CanonicalMarket[] = []
    const rawPayloads: unknown[] = []
    const errors: string[] = []

    // Run league fetches through a concurrency-limited pool (MAX_CONCURRENT at a time)
    // so we don't open all 7 TCP connections at once and risk Vercel hangs.
    const tasks = TARGETS.map(t => async () => {
      const data = await kambiGet(`/listView/${t.sport}/${t.league}.json?${PARAMS}`)
      return { target: t, data }
    })

    const results = await poolAll(tasks, MAX_CONCURRENT)

    for (const res of results) {
      if (res.status === 'rejected') { errors.push(res.reason?.message ?? String(res.reason)); continue }
      const { target, data } = res.value
      rawPayloads.push(data)
      let count = 0
      for (const item of data.events ?? []) {
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
      console.log(`[betrivers_on] ${target.slug}: ${count} events`)
    }

    console.log(`[betrivers_on] done: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`)
    return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    const data = await kambiGet(`/betoffer/event/${eventId}.json?lang=en_CA&includeParticipants=true`)
    return { raw: data, markets: extractMarkets(data, eventId, '') }
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const data = await kambiGet(`/listView/basketball/nba.json?${PARAMS}`)
      const count = (data.events ?? []).length
      if (count === 0) throw new Error('No NBA events')
      return { healthy: true, latencyMs: Date.now() - start, message: `ok — ${count} NBA events` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
