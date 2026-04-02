// ─────────────────────────────────────────────────────────────────────────────
// PointsBet Ontario adapter
//
// Endpoint discovery: 2026-04-01
//   Base:    https://api.on.pointsbet.com/api/v2
//   Auth:    None (public API) — but protected by Cloudflare Bot Management
//   Origin:  https://on.pointsbet.ca
//
// Uses Playwright (real Chromium) to bypass Cloudflare TLS fingerprinting.
// One browser session per fetchEvents() call — visits the site once to get
// CF cookies, then fetches all competitions and events from within the browser.
//
// Data flow:
//   1. Visit https://on.pointsbet.ca to get Cloudflare cookies
//   2. GET /sports/{sport}/competitions  → competition list per sport
//   3. GET /competitions/{key}?page=1   → events with embedded markets
//
// Prices are DECIMAL — converted via decimalToAmerican().
// Markets are embedded in event responses under specialFixedOddsMarkets.
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
import { withBrowser } from '../browser-fetch'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE = 'https://api.on.pointsbet.com/api/v2'
const SEED_URL = 'https://on.pointsbet.ca/sports/basketball'

const SPORTS = ['basketball', 'americanfootball', 'icehockey', 'baseball', 'soccer', 'tennis']

const API_HEADERS = {
  Origin: 'https://on.pointsbet.ca',
  Referer: 'https://on.pointsbet.ca/',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCompetitions(
  data: any,
  sportKey: string
): Array<{ key: string; name: string; sportKey: string }> {
  const seen = new Set<string>()
  const result: Array<{ key: string; name: string; sportKey: string }> = []
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

function mapSide(side: string, name: string): string {
  const s = side.toLowerCase()
  if (s === 'home') return 'home'
  if (s === 'away') return 'away'
  const n = name.toLowerCase()
  if (n.startsWith('over')) return 'over'
  if (n.startsWith('under')) return 'under'
  return s
}

function mapMarketType(eventClass: string): 'moneyline' | 'spread' | 'total' | null {
  const c = eventClass.toLowerCase()
  if (c.includes('moneyline')) return 'moneyline'
  if (c.includes('spread')) return 'spread'
  if (c.includes('total')) return 'total'
  return null
}

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

function buildMarket(eventId: string, leagueSlug: string, raw: any): CanonicalMarket | null {
  const marketType = mapMarketType(raw.eventClass ?? '')
  if (!marketType) return null

  const outcomes: CanonicalOutcome[] = (raw.outcomes ?? [])
    .map(buildOutcome)
    .filter((o: CanonicalOutcome | null): o is CanonicalOutcome => o !== null)

  if (outcomes.length === 0) return null

  let lineValue: number | null = null
  if (marketType !== 'moneyline') {
    const first = (raw.outcomes ?? []).find((o: any) => o.points != null && o.points !== 0)
    lineValue = first ? Math.abs(first.points) : null
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

function toLeagueSlug(competitionName: string): string {
  const known: Record<string, string> = {
    nba: 'nba', nhl: 'nhl', nfl: 'nfl', mlb: 'mlb', mls: 'mls',
    ncaa: 'ncaa', ncaaw: 'ncaaw', nit: 'nit', epl: 'epl',
    euroleague: 'euroleague',
  }
  const short = competitionName.split(' ')[0].toLowerCase()
  const full = competitionName.toLowerCase().replace(/\s+/g, '_')
  return known[short] ?? known[full] ?? full
}

function parseEvents(
  data: any,
  leagueSlug: string
): { events: CanonicalEvent[]; markets: CanonicalMarket[] } {
  const events: CanonicalEvent[] = []
  const markets: CanonicalMarket[] = []

  for (const e of data.events ?? []) {
    events.push(
      normalizeEvent({
        externalId: String(e.key),
        homeTeam: e.homeTeam ?? '',
        awayTeam: e.awayTeam ?? '',
        startTime: e.startsAt ?? '',
        leagueSlug,
        sourceSlug: 'pointsbet_on',
        status: e.isLive ? 'inprogress' : undefined,
      })
    )
    for (const m of e.specialFixedOddsMarkets ?? []) {
      const market = buildMarket(String(e.key), leagueSlug, m)
      if (market) markets.push(market)
    }
  }

  return { events, markets }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const pointsbetOnAdapter: SourceAdapter = {
  slug: 'pointsbet_on',

  async fetchEvents(): Promise<FetchEventsResult> {
    const start = Date.now()

    return withBrowser(async ({ visit, fetchJson }) => {
      // Visit site once — Cloudflare sets __cf_bm cookie here
      await visit(SEED_URL)

      const allEvents: CanonicalEvent[] = []
      const allMarkets: CanonicalMarket[] = []
      const rawPayloads: unknown[] = []
      const errors: string[] = []

      // Fetch competitions for each sport
      const allComps: Array<{ key: string; name: string; sportKey: string }> = []

      await Promise.allSettled(
        SPORTS.map(async (sport) => {
          try {
            const data = await fetchJson(`${BASE}/sports/${sport}/competitions`, API_HEADERS)
            allComps.push(...extractCompetitions(data, sport))
          } catch (e: any) {
            errors.push(`competitions ${sport}: ${e.message}`)
          }
        })
      )

      // Fetch events for each competition
      await Promise.allSettled(
        allComps.map(async (comp) => {
          try {
            const data = await fetchJson(`${BASE}/competitions/${comp.key}?page=1`, API_HEADERS)
            rawPayloads.push(data)
            const leagueSlug = toLeagueSlug(comp.name)
            const { events, markets } = parseEvents(data, leagueSlug)
            allEvents.push(...events)
            allMarkets.push(...markets)
          } catch (e: any) {
            errors.push(`comp ${comp.key} (${comp.name}): ${e.message}`)
          }
        })
      )

      console.log(
        `[pointsbet_on] fetchEvents: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`
      )
      if (errors.length) console.error('[pointsbet_on] errors:', errors)

      return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
    })
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    return withBrowser(async ({ visit, fetchJson }) => {
      await visit(SEED_URL)

      const allComps: Array<{ key: string; name: string; sportKey: string }> = []
      for (const sport of SPORTS) {
        try {
          const data = await fetchJson(`${BASE}/sports/${sport}/competitions`, API_HEADERS)
          allComps.push(...extractCompetitions(data, sport))
        } catch {}
      }

      for (const comp of allComps) {
        try {
          const data = await fetchJson(`${BASE}/competitions/${comp.key}?page=1`, API_HEADERS)
          const event = (data.events ?? []).find((e: any) => String(e.key) === eventId)
          if (!event) continue
          const leagueSlug = toLeagueSlug(comp.name)
          const markets: CanonicalMarket[] = (event.specialFixedOddsMarkets ?? [])
            .map((m: any) => buildMarket(eventId, leagueSlug, m))
            .filter((m: CanonicalMarket | null): m is CanonicalMarket => m !== null)
          return { raw: event, markets }
        } catch {}
      }

      throw new Error(`PointsBet ON: event ${eventId} not found`)
    })
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await withBrowser(async ({ visit, fetchJson }) => {
        await visit(SEED_URL)
        await fetchJson(`${BASE}/sports/basketball/competitions`, API_HEADERS)
      })
      const latencyMs = Date.now() - start
      return { healthy: true, latencyMs, message: `ok (${latencyMs}ms)` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
