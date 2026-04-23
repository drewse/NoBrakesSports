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
import type { ScrapeResult, GameMarket, NormalizedProp, ScrapedEvent } from '../lib/types.js'

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
  type: string            // 'MONEY' | 'SPREAD' | 'OVERUNDER' | 'PLAYER_POINTS' ...
  eventId?: string        // sometimes inlined on market; else resolve by description
  description: string     // sometimes a team abbr ("HOU") for moneyline anchor
  /** For SPREAD / OVERUNDER this is the handicap / total line. For props
   *  it's the line (e.g. 25.5 points). 0 for moneyline. */
  strike: number
  outcomes: Array<{ outcomeId: string; index: number; description: string }>
  /** outcomeId → best bid (buyer side), best ask (seller side). Both are
   *  implied probabilities 0-1 on Novig's scale. */
  ladders: Record<string, { bestBid: number | null; bestAsk: number | null }>
}

/** Map a raw Novig market.type string to our canonical prop_category.
 *  Returns null for non-prop (game-line) market types. */
function propCategoryFromType(type: string): string | null {
  const t = type.toLowerCase()
  // Non-prop market types — caller handles these as game markets.
  if (t === 'money' || t === 'moneyline' || t === 'spread' || t === 'overunder' ||
      t === 'total' || t === 'championship_winner' || t === 'future') return null

  // Basketball
  if (/player_points|points_scored/.test(t)) return 'player_points'
  if (/player_rebounds/.test(t)) return 'player_rebounds'
  if (/player_assists/.test(t)) return 'player_assists'
  if (/player_threes|player_3pt/.test(t)) return 'player_threes'
  if (/player_steals/.test(t)) return 'player_steals'
  if (/player_blocks/.test(t)) return 'player_blocks'
  if (/player_turnovers/.test(t)) return 'player_turnovers'
  if (/player_pts_rebs_asts|player_pra/.test(t)) return 'player_pts_rebs_asts'
  if (/player_pts_rebs/.test(t)) return 'player_pts_rebs'
  if (/player_pts_asts/.test(t)) return 'player_pts_asts'
  if (/player_rebs_asts/.test(t)) return 'player_rebs_asts'
  // Baseball
  if (/player_home_runs|player_hr/.test(t)) return 'player_home_runs'
  if (/player_hits/.test(t)) return 'player_hits'
  if (/player_rbis/.test(t)) return 'player_rbis'
  if (/player_strikeouts/.test(t)) return 'player_strikeouts_p'
  if (/player_total_bases/.test(t)) return 'player_total_bases'
  if (/player_stolen_bases/.test(t)) return 'player_stolen_bases'
  // Hockey
  if (/player_goals/.test(t)) return 'player_goals'
  if (/player_shots/.test(t)) return 'player_shots_on_goal'
  if (/player_points_hockey|player_hockey_points/.test(t)) return 'player_points_hockey'
  // Football
  if (/passing_yards|pass_yards/.test(t)) return 'player_passing_yards'
  if (/rushing_yards|rush_yards/.test(t)) return 'player_rushing_yards'
  if (/receiving_yards|recv_yards/.test(t)) return 'player_receiving_yards'
  if (/touchdowns|player_td/.test(t)) return 'player_touchdowns'

  // Generic player_* catch-all so unmapped props still land.
  if (/^player_/.test(t)) return t
  return null
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

/** Walk the GraphQL event graph collecting every market UUID referenced
 *  inside event nodes. Novig's event schema embeds markets under fields
 *  like `markets[]`, `market_ids[]`, or nested `market.id`. We walk
 *  permissively so any UUID-shaped string inside an event subtree counts. */
function walkForMarketIds(body: any, out: Set<string>) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const seen = new Set<any>()
  const walk = (node: any, inEvent: boolean) => {
    if (!node || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { for (const n of node) walk(n, inEvent); return }

    // Enter "event subtree" mode when we hit an event-shaped node, so
    // nested UUIDs are treated as event-scoped market refs.
    const isEvent = inEvent || (
      typeof node.id === 'string' &&
      (node.scheduled_start || node.scheduledStart) &&
      node.game
    )

    // Harvest market IDs from common field names.
    const candidates = [
      node.market_id, node.marketId,
      ...(Array.isArray(node.market_ids) ? node.market_ids : []),
      ...(Array.isArray(node.marketIds) ? node.marketIds : []),
    ]
    for (const v of candidates) {
      if (typeof v === 'string' && UUID_RE.test(v)) out.add(v)
    }
    if (Array.isArray(node.markets)) {
      for (const m of node.markets) {
        if (m?.id && typeof m.id === 'string' && UUID_RE.test(m.id)) out.add(m.id)
        if (m?.marketId && typeof m.marketId === 'string' && UUID_RE.test(m.marketId)) out.add(m.marketId)
      }
    }
    for (const v of Object.values(node)) walk(v, isEvent)
  }
  walk(body, false)
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
      strike: typeof market.strike === 'number' ? market.strike : 0,
      outcomes,
      ladders,
    })
  }
}

/** Take best ask (price you'd buy at). Fall back to bid if ask missing. */
function pickPrice(l?: { bestBid: number | null; bestAsk: number | null }): number | null {
  if (!l) return null
  const p = l.bestAsk ?? l.bestBid
  return p != null ? probToAmerican(p) : null
}

/** Split outcomes into a (home, away) pair by team symbol/name match. */
function splitHomeAway(
  ev: NovigEvent,
  outcomes: NovigMarket['outcomes'],
): { home?: NovigMarket['outcomes'][number]; away?: NovigMarket['outcomes'][number] } {
  let home, away
  const homeSym = ev.homeTeamSymbol.toLowerCase()
  const homeName = ev.homeTeamName.toLowerCase()
  const awaySym = ev.awayTeamSymbol.toLowerCase()
  const awayName = ev.awayTeamName.toLowerCase()
  for (const o of outcomes) {
    const d = o.description.toLowerCase()
    if (d === homeSym || d === homeName || d.includes(homeName)) home = o
    else if (d === awaySym || d === awayName || d.includes(awayName)) away = o
  }
  return { home, away }
}

/** Split outcomes into (over, under) by description prefix. */
function splitOverUnder(
  outcomes: NovigMarket['outcomes'],
): { over?: NovigMarket['outcomes'][number]; under?: NovigMarket['outcomes'][number] } {
  let over, under
  for (const o of outcomes) {
    const d = o.description.toLowerCase().trim()
    if (d === 'over' || d.startsWith('over ') || d === 'o') over = o
    else if (d === 'under' || d.startsWith('under ') || d === 'u') under = o
  }
  return { over, under }
}

/** Convert the market to our GameMarket shape. Returns null if the market
 *  isn't a recognized game-line type (or if prices are all missing). */
function buildGameMarket(ev: NovigEvent, market: NovigMarket): GameMarket | null {
  const t = market.type.toUpperCase()

  if (t === 'MONEY' || t === 'MONEYLINE') {
    const { home, away } = splitHomeAway(ev, market.outcomes)
    if (!home || !away) return null
    const hp = pickPrice(market.ladders[home.outcomeId])
    const ap = pickPrice(market.ladders[away.outcomeId])
    if (hp == null && ap == null) return null
    return {
      marketType: 'moneyline',
      homePrice: hp, awayPrice: ap, drawPrice: null,
      spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
    }
  }

  if (t === 'SPREAD' || t === 'HANDICAP' || t === 'POINT_SPREAD') {
    const { home, away } = splitHomeAway(ev, market.outcomes)
    if (!home || !away) return null
    const hp = pickPrice(market.ladders[home.outcomeId])
    const ap = pickPrice(market.ladders[away.outcomeId])
    if (hp == null && ap == null) return null
    return {
      marketType: 'spread',
      homePrice: hp, awayPrice: ap, drawPrice: null,
      spreadValue: market.strike || null,
      totalValue: null, overPrice: null, underPrice: null,
    }
  }

  if (t === 'OVERUNDER' || t === 'TOTAL' || t === 'TOTALS' || t === 'OVER_UNDER') {
    const { over, under } = splitOverUnder(market.outcomes)
    if (!over && !under) return null
    const op = pickPrice(over ? market.ladders[over.outcomeId] : undefined)
    const up = pickPrice(under ? market.ladders[under.outcomeId] : undefined)
    if (op == null && up == null) return null
    return {
      marketType: 'total',
      homePrice: null, awayPrice: null, drawPrice: null,
      spreadValue: null,
      totalValue: market.strike || null,
      overPrice: op, underPrice: up,
    }
  }

  return null
}

/** Build a player-prop row from a prop market. Player name is in the
 *  market.description on Novig (e.g. "Tyrese Maxey Points"). Outcomes are
 *  OVER / UNDER, line is market.strike. */
function buildProp(market: NovigMarket): NormalizedProp | null {
  const category = propCategoryFromType(market.type)
  if (!category) return null

  // Extract player name: Novig's description often includes the stat name.
  // Strip trailing stat type if present (e.g. "Tyrese Maxey Points" →
  // "Tyrese Maxey"). Crude but works for most American sports.
  const STAT_TRAIL = /\s+(points|rebounds|assists|threes|steals|blocks|turnovers|goals|shots|hits|home runs|rbis|strikeouts|bases|yards|touchdowns|passing|rushing|receiving|total bases|stolen bases)$/i
  const playerName = market.description.replace(STAT_TRAIL, '').trim()
  if (!playerName) return null

  const { over, under } = splitOverUnder(market.outcomes)
  if (!over && !under) return null
  const op = pickPrice(over ? market.ladders[over.outcomeId] : undefined)
  const up = pickPrice(under ? market.ladders[under.outcomeId] : undefined)
  if (op == null && up == null) return null

  return {
    propCategory: category,
    playerName,
    lineValue: market.strike || null,
    overPrice: op,
    underPrice: up,
    yesPrice: null,
    noPrice: null,
    isBinary: false,
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
      const marketIds = new Set<string>()   // harvested from GraphQL event graph
      let graphqlCount = 0
      let batchCount = 0

      // Capture a sample batch request so we can replay it later with the
      // market IDs we harvested from GraphQL. The app itself only fetches
      // books for markets visible on the league landing page (moneyline
      // ribbons) — we want spreads/totals/props too.
      interface BatchSample { url: string; method: string; postData: string | null; headers: Record<string, string> }
      const batchSampleRef: { value: BatchSample | null } = { value: null }
      page.on('request', (req) => {
        const u = req.url()
        if (!u.includes('/nbx/v1/markets/book/batch') || batchSampleRef.value) return
        batchSampleRef.value = {
          url: u,
          method: req.method(),
          postData: req.postData() ?? null,
          headers: req.headers(),
        }
      })

      page.on('response', async (resp) => {
        const u = resp.url()
        if (resp.status() !== 200) return
        try {
          if (u.includes('/v1/graphql')) {
            graphqlCount++
            const body = await resp.json()
            walkForEvents(body, events)
            walkForMarketIds(body, marketIds)
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

      const batchSample = batchSampleRef.value
      log.info('novig capture', {
        graphqlResponses: graphqlCount,
        batchResponses: batchCount,
        events: events.size,
        passiveMarkets: markets.size,
        harvestedMarketIds: marketIds.size,
        batchSample: batchSample ? {
          url: batchSample.url.slice(0, 200),
          method: batchSample.method,
          postLen: batchSample.postData?.length ?? 0,
          postPreview: batchSample.postData?.slice(0, 400) ?? null,
        } : null,
      })

      // Active batch fetch: replay the app's /nbx/v1/markets/book/batch
      // call with every market ID we harvested from the GraphQL event
      // graph. The passive capture only got the handful of markets
      // visible on the league landing pages (moneyline ribbons). This
      // unlocks spreads, totals, and player props across every event.
      //
      // We fetch from inside the page context (page.evaluate) so cookies
      // and any CORS handshake the app needs come along for free.
      if (batchSample && marketIds.size > 0) {
        const ids = [...marketIds]
        const CHUNK = 40
        // Use Playwright's APIRequestContext. It shares the cookie jar
        // with the page, but requests run outside the page's JS sandbox —
        // which means no CORS check. This is the correct layer for
        // replaying API calls that the app itself makes.
        const apiCtx = page.context().request

        for (let i = 0; i < ids.length; i += CHUNK) {
          if (signal.aborted) break
          const batch = ids.slice(i, i + CHUNK)
          try {
            // Build the URL exactly the way the app did — GET with a
            // comma-separated marketIds query param. We always use GET
            // because that's what we observed; the POST branch was
            // defensive scaffolding and has never actually fired.
            const parsed = new URL(batchSample.url)
            parsed.searchParams.delete('marketIds')
            parsed.searchParams.delete('market_ids')
            parsed.searchParams.delete('ids')
            parsed.searchParams.set('marketIds', batch.join(','))
            const url = parsed.toString()

            const resp = await apiCtx.get(url, {
              headers: { 'accept': 'application/json' },
              timeout: 15_000,
            })
            const status = resp.status()
            const bodyText = await resp.text().catch(() => '')

            const result = { status, body: bodyText.slice(0, 500_000), err: null as string | null }
            if (result.err) {
              errors.push(`active batch ${i}: fetch threw: ${result.err}`)
              log.warn('active batch fetch threw', { chunkStart: i, err: result.err })
              continue
            }
            const beforeSize = markets.size
            let parsedOk = false
            if (result.status === 200) {
              try {
                walkForMarkets(JSON.parse(result.body), markets)
                parsedOk = true
              } catch (pe: any) {
                log.warn('active batch JSON parse failed', { message: pe?.message ?? String(pe), preview: result.body.slice(0, 300) })
              }
            } else {
              errors.push(`active batch ${i}: HTTP ${result.status}`)
              log.warn('active batch non-200', { status: result.status, preview: result.body.slice(0, 400) })
            }
            // Always log one preview per chunk so we see what shape came
            // back regardless of parse success / market-count delta.
            log.info('active batch result', {
              chunkStart: i,
              chunkIds: batch.length,
              status: result.status,
              parsedOk,
              bodyLen: result.body.length,
              preview: result.body.slice(0, 600),
              marketsBefore: beforeSize,
              marketsAfter: markets.size,
            })
          } catch (e: any) {
            errors.push(`active batch ${i}: ${e?.message ?? String(e)}`)
            log.warn('active batch threw', { chunkStart: i, message: e?.message ?? String(e) })
          }
        }
        log.info('novig active fetch', { marketsAfterActive: markets.size })
      }

      // Build the output: one ScrapedEvent per canonical game, accumulating
      // game markets (moneyline/spread/total) and player props into it.
      const emittedEvents = new Map<string, ScrapedEvent>()
      const perLeague: Record<string, { gameMarkets: number; props: number }> = {}
      const typeCounts: Record<string, number> = {}

      function getOrCreateEvent(ev: NovigEvent, lg: typeof LEAGUES[number]): ScrapedEvent {
        const key = `${lg.leagueSlug}|${ev.id}`
        let existing = emittedEvents.get(key)
        if (existing) return existing
        existing = {
          event: {
            externalId: ev.id,
            homeTeam: ev.homeTeamName,
            awayTeam: ev.awayTeamName,
            startTime: ev.startTime,
            leagueSlug: lg.leagueSlug,
            sport: lg.sport,
          },
          gameMarkets: [],
          props: [],
        }
        emittedEvents.set(key, existing)
        return existing
      }

      for (const market of markets.values()) {
        typeCounts[market.type] = (typeCounts[market.type] ?? 0) + 1

        // Resolve to an event across all tracked leagues.
        let ev: NovigEvent | null = null
        let league: typeof LEAGUES[number] | null = null
        for (const lg of LEAGUES) {
          const found = findEventForMarket(market, events, lg.leagueApi)
          if (found) { ev = found; league = lg; break }
        }
        if (!ev || !league) continue
        const ls = league.leagueSlug
        perLeague[ls] ??= { gameMarkets: 0, props: 0 }

        // Try game market first. If that fails, try prop.
        const gm = buildGameMarket(ev, market)
        if (gm) {
          const row = getOrCreateEvent(ev, league)
          row.gameMarkets.push(gm)
          perLeague[ls].gameMarkets++
          continue
        }
        const prop = buildProp(market)
        if (prop) {
          const row = getOrCreateEvent(ev, league)
          row.props.push(prop)
          perLeague[ls].props++
        }
      }

      const scraped: ScrapedEvent[] = [...emittedEvents.values()]
      log.info('novig output', {
        emitted: scraped.length,
        perLeague,
        // Log the distinct market types we saw so we can extend the
        // propCategoryFromType map if Novig uses unexpected names.
        marketTypes: Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20),
      })

      return { events: scraped, errors }
    }, { useProxy: false })
  },
}
