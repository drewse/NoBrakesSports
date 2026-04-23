/**
 * Novig — US sports exchange (CFTC-regulated). Live adapter.
 *
 * API surface captured via discovery:
 *   POST /v1/graphql
 *     Apollo/Hasura endpoint. The `LiveEventTicker_Query` (and its
 *     sibling queries fired on league pages) return events with
 *     `game.homeTeam` / `game.awayTeam` plus `markets` joining the
 *     order-book side.
 *   GET /nbx/v1/markets/book/batch
 *     Order-book snapshot: `[{ market: { id, type, outcomes:[{id,
 *     description}] }, ladders: { [outcomeId]: { bids:[...], asks:[...] } } }]`
 *     Prices in the ladders are implied-probability format (0-1); best
 *     bid on one outcome is close to 1 - best ask on the other side.
 *   GET /nbx/v1/markets/trending-subcategories
 *     League/macrotype groupings. We don't need it for game lines.
 *
 * Strategy: visit app.novig.us + the per-league pages, passively capture
 * every GraphQL response and every markets/book/batch response. From
 * GraphQL we learn event → team-names. From the batch we learn
 * event → market outcomes → price ladders. Join the two to emit game
 * moneyline rows. No proxy required — Novig serves direct Railway IPs.
 *
 * V1 handles moneyline only. Spread/total are separate market types on
 * Novig's schema and will land in a follow-up.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, ScrapedEvent } from '../lib/types.js'

const SEED_URL = 'https://app.novig.us'

const LEAGUES: Array<{ path: string; leagueApi: string; leagueSlug: string; sport: string }> = [
  { path: '/nba', leagueApi: 'NBA', leagueSlug: 'nba', sport: 'basketball' },
  { path: '/mlb', leagueApi: 'MLB', leagueSlug: 'mlb', sport: 'baseball' },
  { path: '/nhl', leagueApi: 'NHL', leagueSlug: 'nhl', sport: 'ice_hockey' },
  { path: '/nfl', leagueApi: 'NFL', leagueSlug: 'nfl', sport: 'football' },
]

interface NovigEvent {
  id: string
  league: string
  startTime: string
  homeTeamName: string
  awayTeamName: string
  homeTeamSymbol: string
  awayTeamSymbol: string
}

interface NovigMarket {
  marketId: string
  type: string            // 'MONEY' | 'SPREAD' | 'OVERUNDER' etc.
  eventId?: string        // sometimes inlined on market; else resolve by description
  description: string     // sometimes a team abbr ("HOU") for moneyline anchor
  outcomes: Array<{ outcomeId: string; index: number; description: string }>
  /** outcomeId → best bid (buyer side), best ask (seller side). Both are
   *  implied probabilities 0-1 on Novig's scale. */
  ladders: Record<string, { bestBid: number | null; bestAsk: number | null }>
}

/** Convert an implied probability (0-1) to an American odds integer.
 *  On Novig you typically take the best ask (the price you'd buy at) as
 *  the "price to bet". */
function probToAmerican(p: number): number | null {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return null
  const d = 1 / p
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

/** Walk a GraphQL response body looking for event-shaped nodes. Novig's
 *  Hasura schema puts events under data.upcoming_events / data.live_events
 *  / data.event / etc. depending on the operation. Shape varies so we walk
 *  generically and collect any node that has id + scheduled_start + game. */
function walkForEvents(body: any, out: Map<string, NovigEvent>) {
  const seen = new Set<any>()
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { for (const n of node) walk(n); return }

    const id = node.id
    const start = node.scheduled_start ?? node.scheduledStart
    const game = node.game
    const league = node.league
    if (typeof id === 'string' && typeof start === 'string' && game && league && !out.has(id)) {
      const home = game.homeTeam ?? game.home_team
      const away = game.awayTeam ?? game.away_team
      const homeName = home?.long_name ?? home?.short_name ?? home?.name ?? home?.symbol
      const awayName = away?.long_name ?? away?.short_name ?? away?.name ?? away?.symbol
      if (homeName && awayName) {
        out.set(id, {
          id,
          league: String(league),
          startTime: new Date(start).toISOString(),
          homeTeamName: String(homeName),
          awayTeamName: String(awayName),
          homeTeamSymbol: String(home?.symbol ?? home?.abbreviation ?? ''),
          awayTeamSymbol: String(away?.symbol ?? away?.abbreviation ?? ''),
        })
      }
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(body)
}

/** Walk a /nbx/v1/markets/book/batch response collecting markets with
 *  their ladder (best bid/ask per outcome). The response is an array of
 *  entries like `{ market: {...}, ladders: { [outcomeId]: {...} } }`. */
function walkForMarkets(body: any, out: Map<string, NovigMarket>) {
  const entries = Array.isArray(body) ? body
    : Array.isArray(body?.data) ? body.data
    : Array.isArray(body?.markets) ? body.markets
    : []
  for (const entry of entries) {
    const market = entry?.market
    if (!market?.id || !Array.isArray(market.outcomes)) continue
    const outcomes = market.outcomes
      .filter((o: any) => o?.id && typeof o.description === 'string')
      .map((o: any) => ({
        outcomeId: String(o.id),
        index: Number(o.index ?? 0),
        description: String(o.description),
      }))
    if (outcomes.length < 2) continue

    const raw = entry.ladders ?? {}
    const ladders: NovigMarket['ladders'] = {}
    for (const out of outcomes) {
      const l = raw[out.outcomeId]
      // Ladder shape variants: {bids:[{price}], asks:[{price}]} or
      // {bestBid, bestAsk} or {bid, ask}. Handle all.
      const bestBid = l?.bestBid ?? l?.bid
        ?? (Array.isArray(l?.bids) && l.bids.length ? l.bids[0]?.price ?? l.bids[0]?.probability : null)
      const bestAsk = l?.bestAsk ?? l?.ask
        ?? (Array.isArray(l?.asks) && l.asks.length ? l.asks[0]?.price ?? l.asks[0]?.probability : null)
      ladders[out.outcomeId] = {
        bestBid: typeof bestBid === 'number' ? bestBid : null,
        bestAsk: typeof bestAsk === 'number' ? bestAsk : null,
      }
    }

    out.set(String(market.id), {
      marketId: String(market.id),
      type: String(market.type ?? ''),
      eventId: market.eventId ?? market.event_id,
      description: String(market.description ?? ''),
      outcomes,
      ladders,
    })
  }
}

/** Map a Novig event + its moneyline market to our GameMarket shape. */
function buildMoneylineGameMarket(ev: NovigEvent, market: NovigMarket): GameMarket | null {
  if (market.type !== 'MONEY' && market.type !== 'MONEYLINE') return null

  // Outcomes come in as { description: 'HOU', outcomeId: '...' }. Match
  // each outcome to home or away by symbol (the common case) or name.
  let homeOutcome: typeof market.outcomes[number] | undefined
  let awayOutcome: typeof market.outcomes[number] | undefined
  for (const o of market.outcomes) {
    const d = o.description.toLowerCase()
    if (d === ev.homeTeamSymbol.toLowerCase() || d === ev.homeTeamName.toLowerCase()) homeOutcome = o
    else if (d === ev.awayTeamSymbol.toLowerCase() || d === ev.awayTeamName.toLowerCase()) awayOutcome = o
  }
  if (!homeOutcome || !awayOutcome) return null

  // Bet-taker price = ask side. If ask is missing fall back to bid.
  const homeProb = market.ladders[homeOutcome.outcomeId]?.bestAsk
    ?? market.ladders[homeOutcome.outcomeId]?.bestBid
  const awayProb = market.ladders[awayOutcome.outcomeId]?.bestAsk
    ?? market.ladders[awayOutcome.outcomeId]?.bestBid

  const homePrice = homeProb != null ? probToAmerican(homeProb) : null
  const awayPrice = awayProb != null ? probToAmerican(awayProb) : null
  if (homePrice == null && awayPrice == null) return null

  return {
    marketType: 'moneyline',
    homePrice, awayPrice, drawPrice: null,
    spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
  }
}

/** Match a market to an event. Novig's moneyline markets sometimes have
 *  an inlined eventId; when they don't, we resolve by outcome descriptions
 *  matching the event's team symbols. */
function findEventForMarket(
  market: NovigMarket,
  events: Map<string, NovigEvent>,
  leagueFilter: string,
): NovigEvent | null {
  if (market.eventId) {
    const byId = events.get(market.eventId)
    if (byId) return byId
  }
  const syms = new Set(market.outcomes.map(o => o.description.toLowerCase()))
  for (const ev of events.values()) {
    if (ev.league !== leagueFilter) continue
    if (syms.has(ev.homeTeamSymbol.toLowerCase()) && syms.has(ev.awayTeamSymbol.toLowerCase())) {
      return ev
    }
  }
  return null
}

export const novigAdapter: BookAdapter = {
  slug: 'novig',
  name: 'Novig',
  pollIntervalSec: 300,   // 5 min — direct Railway IP, no proxy cost
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const events = new Map<string, NovigEvent>()
      const markets = new Map<string, NovigMarket>()
      let graphqlCount = 0
      let batchCount = 0

      page.on('response', async (resp) => {
        const u = resp.url()
        if (resp.status() !== 200) return
        try {
          if (u.includes('/v1/graphql')) {
            graphqlCount++
            const body = await resp.json()
            walkForEvents(body, events)
          } else if (u.includes('/nbx/v1/markets/book/batch')) {
            batchCount++
            const body = await resp.json()
            walkForMarkets(body, markets)
          }
        } catch { /* body closed / non-JSON */ }
      })

      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(4_000)
      } catch (e: any) {
        log.error('seed failed', { url: SEED_URL, message: e?.message ?? String(e) })
        errors.push(`seed: ${e?.message ?? String(e)}`)
        return { events: [], errors }
      }

      for (const lg of LEAGUES) {
        if (signal.aborted) break
        try {
          await page.goto(SEED_URL + lg.path, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          // Wait for the app's GraphQL + batch XHRs to settle.
          await page.waitForTimeout(4_000)
        } catch (e: any) {
          errors.push(`${lg.leagueSlug} nav: ${e?.message ?? String(e)}`)
        }
      }

      log.info('novig capture', {
        graphqlResponses: graphqlCount,
        batchResponses: batchCount,
        events: events.size,
        markets: markets.size,
      })

      // Build the output: per league, walk markets, attach to events.
      const scraped: ScrapedEvent[] = []
      const perLeague: Record<string, { matched: number; unmatched: number; withMarket: number }> = {}

      // Index events keyed by (league, home symbol, away symbol) so we
      // can emit exactly one ScrapedEvent per canonical game even if the
      // same event surfaces from multiple markets.
      const emittedEvents = new Map<string, ScrapedEvent>()

      for (const market of markets.values()) {
        for (const lg of LEAGUES) {
          const ev = findEventForMarket(market, events, lg.leagueApi)
          if (!ev) continue
          const ls = lg.leagueSlug
          perLeague[ls] ??= { matched: 0, unmatched: 0, withMarket: 0 }
          perLeague[ls].matched++

          const gm = buildMoneylineGameMarket(ev, market)
          if (!gm) continue
          perLeague[ls].withMarket++

          const key = `${lg.leagueSlug}|${ev.id}`
          const existing = emittedEvents.get(key)
          if (existing) {
            existing.gameMarkets.push(gm)
          } else {
            emittedEvents.set(key, {
              event: {
                externalId: ev.id,
                homeTeam: ev.homeTeamName,
                awayTeam: ev.awayTeamName,
                startTime: ev.startTime,
                leagueSlug: lg.leagueSlug,
                sport: lg.sport,
              },
              gameMarkets: [gm],
              props: [],
            })
          }
          break
        }
      }

      for (const s of emittedEvents.values()) scraped.push(s)

      log.info('novig output', {
        emitted: scraped.length,
        perLeague,
      })

      return { events: scraped, errors }
    }, { useProxy: false })
  },
}
