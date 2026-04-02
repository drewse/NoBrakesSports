// ─────────────────────────────────────────────────────────────────────────────
// PointsBet Ontario adapter
//
// Endpoint discovery: 2026-04-01
//   Base:    https://api.on.pointsbet.com/api/v2
//   Auth:    None — public Cloudflare-cached API
//   Origin:  https://on.pointsbet.ca
//
// Data flow:
//   1. GET /sports/{sport}/competitions
//      → { locales: [{ key, competitions: [{ key, name, numberOfEvents }] }] }
//   2. GET /competitions/{competitionKey}?page=1
//      → { events: [{ key, homeTeam, awayTeam, startsAt, specialFixedOddsMarkets[] }] }
//
// Markets are EMBEDDED in the event response under specialFixedOddsMarkets —
// no separate markets endpoint is needed. fetchMarkets() re-fetches the
// competition to find the specific event.
//
// Prices are DECIMAL (e.g. 1.9091) — converted via decimalToAmerican().
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
import { normalizeEvent, decimalToAmerican, americanToImplied, detectMarketShape } from '../normalize'
import { pipeFetch } from '../proxy-fetch'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = 'https://api.on.pointsbet.com/api/v2'

// Sports to index. Add more as confirmed in devtools.
const SPORTS = ['basketball', 'americanfootball', 'icehockey', 'baseball', 'soccer', 'tennis']

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-CA,en;q=0.9',
  Origin: 'https://on.pointsbet.ca',
  Referer: 'https://on.pointsbet.ca/',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function apiFetch(path: string): Promise<any> {
  const res = await pipeFetch(`${BASE}${path}`, { headers: HEADERS })
  if (!res.ok) throw Object.assign(new Error(`PointsBet ON: HTTP ${res.status} for ${path}`), { type: 'network' })
  return res.json()
}

/**
 * Flattens competition list from the locales structure.
 * Skips futures (name contains "Futures") and empty competitions.
 */
function extractCompetitions(data: any): Array<{ key: string; name: string; sportKey: string }> {
  const seen = new Set<string>()
  const result: Array<{ key: string; name: string; sportKey: string }> = []
  const sportKey: string = data.key ?? ''
  for (const locale of data.locales ?? []) {
    for (const comp of locale.competitions ?? []) {
      if (seen.has(comp.key)) continue
      if (!comp.numberOfEvents || comp.numberOfEvents === 0) continue
      if ((comp.name as string).toLowerCase().includes('futures')) continue
      seen.add(comp.key)
      result.push({ key: comp.key, name: comp.name, sportKey })
    }
  }
  return result
}

/**
 * Maps PointsBet `side` + outcome name to a canonical side string.
 * "Home" → "home", "Away" → "away", "Neither" → "over" or "under" from name.
 */
function mapSide(side: string, name: string): string {
  const s = side.toLowerCase()
  if (s === 'home') return 'home'
  if (s === 'away') return 'away'
  const n = name.toLowerCase()
  if (n.startsWith('over')) return 'over'
  if (n.startsWith('under')) return 'under'
  return s
}

/**
 * Maps PointsBet eventClass to a canonical market type.
 * "Moneyline" → "moneyline", "Point Spread" → "spread", "Total" → "total"
 */
function mapMarketType(eventClass: string): 'moneyline' | 'spread' | 'total' | null {
  const c = eventClass.toLowerCase()
  if (c.includes('moneyline')) return 'moneyline'
  if (c.includes('spread')) return 'spread'
  if (c.includes('total')) return 'total'
  return null
}

/**
 * Converts PointsBet decimal price to a CanonicalOutcome.
 * Filters out hidden or closed outcomes.
 */
function buildOutcome(raw: any): CanonicalOutcome | null {
  if (raw.isHidden || !raw.isOpenForBetting) return null
  let price: number
  try {
    price = decimalToAmerican(raw.price)
  } catch {
    return null
  }
  return {
    side: mapSide(raw.side ?? '', raw.name ?? '') as any,
    label: (raw.name ?? '').trim(),
    price,
    impliedProb: americanToImplied(price),
  }
}

/**
 * Converts a specialFixedOddsMarket object from a PointsBet event into a
 * CanonicalMarket. Returns null if the market type is unrecognised.
 */
function buildMarket(eventId: string, leagueSlug: string, raw: any): CanonicalMarket | null {
  const marketType = mapMarketType(raw.eventClass ?? '')
  if (!marketType) return null

  const outcomes: CanonicalOutcome[] = (raw.outcomes ?? [])
    .map(buildOutcome)
    .filter((o: CanonicalOutcome | null): o is CanonicalOutcome => o !== null)

  if (outcomes.length === 0) return null

  // lineValue: the spread or total line. For spread, use the first outcome's points.
  // For total, same. For moneyline it's null.
  let lineValue: number | null = null
  if (marketType !== 'moneyline') {
    const firstOutcome = (raw.outcomes ?? []).find((o: any) => o.points != null && o.points !== 0)
    lineValue = firstOutcome ? Math.abs(firstOutcome.points) : null
  }

  return {
    eventId,
    marketType,
    shape: detectMarketShape(leagueSlug, marketType),
    outcomes,
    lineValue,
    sourceSlug: 'pointsbet_on',
    capturedAt: new Date().toISOString(),
  }
}

/**
 * Extracts the canonical leagueSlug from competition name + sportKey.
 * e.g. competitionName="NBA", sportKey="basketball" → "nba"
 */
function toLeagueSlug(competitionName: string, sportKey: string): string {
  const name = competitionName.toLowerCase().replace(/\s+/g, '_')
  // Well-known mappings
  const known: Record<string, string> = {
    nba: 'nba',
    nhl: 'nhl',
    nfl: 'nfl',
    mlb: 'mlb',
    mls: 'mls',
    ncaa: 'ncaa',
    ncaaw: 'ncaaw',
    nit: 'nit',
    epl: 'epl',
    euroleague: 'euroleague',
  }
  // Try short name first
  const shortName = competitionName.split(' ')[0].toLowerCase()
  return known[shortName] ?? known[name] ?? name
}

// ── Core fetch helpers ────────────────────────────────────────────────────────

/**
 * Fetches all competitions across all configured sports.
 */
async function fetchAllCompetitions(): Promise<{ comps: Array<{ key: string; name: string; sportKey: string }>; errors: string[] }> {
  const comps: Array<{ key: string; name: string; sportKey: string }> = []
  const errors: string[] = []
  const settled = await Promise.allSettled(
    SPORTS.map(async (sport) => {
      const data = await apiFetch(`/sports/${sport}/competitions`)
      return { sport, data }
    })
  )
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      comps.push(...extractCompetitions(result.value.data))
    } else {
      errors.push(`sport fetch failed: ${result.reason?.message ?? result.reason}`)
    }
  }
  return { comps, errors }
}

/**
 * Fetches all events (with embedded markets) for a single competition.
 */
async function fetchCompetitionEvents(
  competitionKey: string,
  competitionName: string,
  sportKey: string
): Promise<{ events: CanonicalEvent[]; markets: CanonicalMarket[]; raw: unknown }> {
  const data = await apiFetch(`/competitions/${competitionKey}?page=1`)
  const leagueSlug = toLeagueSlug(competitionName, sportKey)
  const events: CanonicalEvent[] = []
  const markets: CanonicalMarket[] = []

  for (const e of data.events ?? []) {
    // Skip events that haven't started yet but have no betting open
    const event = normalizeEvent({
      externalId: String(e.key),
      homeTeam: e.homeTeam ?? '',
      awayTeam: e.awayTeam ?? '',
      startTime: e.startsAt ?? '',
      leagueSlug,
      sourceSlug: 'pointsbet_on',
      status: e.isLive ? 'inprogress' : undefined,
    })
    events.push(event)

    for (const m of e.specialFixedOddsMarkets ?? []) {
      const market = buildMarket(String(e.key), leagueSlug, m)
      if (market) markets.push(market)
    }
  }

  return { events, markets, raw: data }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const pointsbetOnAdapter: SourceAdapter = {
  slug: 'pointsbet_on',

  async fetchEvents(): Promise<FetchEventsResult> {
    const start = Date.now()
    const { comps, errors: compErrors } = await fetchAllCompetitions()

    const allEvents: CanonicalEvent[] = []
    const allMarkets: CanonicalMarket[] = []
    const rawPayloads: unknown[] = []
    const errors: string[] = [...compErrors]

    const settled = await Promise.allSettled(
      comps.map(async (comp) => {
        const result = await fetchCompetitionEvents(comp.key, comp.name, comp.sportKey)
        return { comp, result }
      })
    )

    for (const s of settled) {
      if (s.status === 'fulfilled') {
        allEvents.push(...s.value.result.events)
        allMarkets.push(...s.value.result.markets)
        rawPayloads.push(s.value.result.raw)
      } else {
        errors.push(`comp fetch failed: ${s.reason?.message ?? s.reason}`)
      }
    }

    console.log(
      `[pointsbet_on] fetchEvents: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`
    )
    if (errors.length) console.error('[pointsbet_on] errors:', errors)

    return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    // Markets are embedded in the event. We need to know the competition key
    // to re-fetch it. Without a direct /events/{id} endpoint confirmed yet,
    // we scan all competitions to find the event.
    //
    // @todo: If a direct /events/{eventId} endpoint exists, use that instead.
    const competitions = await fetchAllCompetitions()

    for (const comp of competitions) {
      try {
        const data = await apiFetch(`/competitions/${comp.key}?page=1`)
        const leagueSlug = toLeagueSlug(comp.name, comp.sportKey)
        const event = (data.events ?? []).find((e: any) => String(e.key) === eventId)
        if (!event) continue

        const markets: CanonicalMarket[] = (event.specialFixedOddsMarkets ?? [])
          .map((m: any) => buildMarket(eventId, leagueSlug, m))
          .filter((m: CanonicalMarket | null): m is CanonicalMarket => m !== null)

        return { raw: event, markets }
      } catch {
        continue
      }
    }

    throw Object.assign(
      new Error(`PointsBet ON: event ${eventId} not found in any competition`),
      { type: 'parse' as const }
    )
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      const res = await pipeFetch(`${BASE}/sports/basketball/competitions`, { headers: HEADERS })
      const latencyMs = Date.now() - start
      return { healthy: res.ok, latencyMs, message: res.ok ? `ok (${latencyMs}ms)` : `HTTP ${res.status}` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message ?? 'unknown error' }
    }
  },
}
