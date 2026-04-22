/**
 * Kambi full prop scraper — BetRivers Ontario (rsicaon).
 *
 * Fetches EVERY betOffer for EVERY event across configured sports.
 * Free, unlimited, no API key. Paginated at 2000 offers/page.
 *
 * Endpoint pattern:
 *   GET /offering/v2018/rsicaon/betoffer/event/{eventId1,eventId2,...}.json
 *       ?lang=en_CA&market=CA-ON&range_start=0&range_size=2000
 */

import {
  mapKambiCategory,
  normalizePlayerName,
  computePropOddsHash,
  americanToImpliedProb,
  type NormalizedProp,
} from '../prop-normalizer'

const KAMBI_CDN = 'https://eu-offering-api.kambicdn.com/offering/v2018'
const DEFAULT_PARAMS = 'lang=en_CA&market=CA-ON'
const PAGE_SIZE = 2000

// Kambi operators with confirmed public API access and distinct odds.
// Optional host/lang/market overrides let us reuse the same scraper for
// US regional operators (different Kambi platform, different market code).
export interface KambiOperator {
  clientId: string
  sourceSlug: string
  displayName: string
  host?: string       // default: KAMBI_CDN
  lang?: string       // default: 'en_CA'
  market?: string     // default: 'CA-ON'
}

export const KAMBI_OPERATORS: KambiOperator[] = [
  { clientId: 'rsicaon',      sourceSlug: 'betrivers',    displayName: 'BetRivers (Ontario)' },
  { clientId: 'leose',        sourceSlug: 'leovegas',     displayName: 'LeoVegas' },
  { clientId: 'torstarcaon',  sourceSlug: 'northstarbets', displayName: 'NorthStar Bets' },

  // ── US Kambi regionals ─────────────────────────────────────────────
  // Different Kambi platform (c3.sb.kambicdn.com), distinct event IDs
  // from CA operators — each US op discovers its own event list.
  { clientId: 'parx',         sourceSlug: 'betparx',      displayName: 'BetParx',
    host: 'https://c3.sb.kambicdn.com/offering/v2018', lang: 'en_US', market: 'US-PA' },
]

// Sports and their Kambi group paths
export const KAMBI_SPORT_PATHS: { sport: string; path: string; groupId?: number }[] = [
  { sport: 'basketball', path: 'basketball/nba' },
  { sport: 'baseball',   path: 'baseball/mlb' },
  { sport: 'ice_hockey', path: 'ice_hockey/nhl' },
  { sport: 'soccer',     path: 'football/england' },
  { sport: 'soccer',     path: 'football/spain' },
  { sport: 'soccer',     path: 'football/germany' },
  { sport: 'soccer',     path: 'football/italy' },
  { sport: 'soccer',     path: 'football/france' },
  { sport: 'soccer',     path: 'football/mexico' },
  { sport: 'soccer',     path: 'football/copa_libertadores' },
  { sport: 'soccer',     path: 'football/copa_sudamericana' },
]

export interface KambiEvent {
  eventId: number
  name: string
  homeName: string
  awayName: string
  start: string
  sport: string
  leaguePath: string
}

export interface KambiGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface KambiPropResult {
  event: KambiEvent
  props: NormalizedProp[]
  gameMarkets: KambiGameMarket[]
}

/**
 * Discover all upcoming events for a sport path.
 * Uses the listView endpoint (confirmed working) not event/group.
 */
async function fetchEvents(base: string, sportPath: string, params: string = DEFAULT_PARAMS): Promise<KambiEvent[]> {
  const url = `${base}/listView/${sportPath}/all/all/matches.json?${params}`
  const resp = await fetch(url)
  if (!resp.ok) return []

  const data = await resp.json()
  const events: KambiEvent[] = []

  for (const item of data.events ?? []) {
    const ev = item.event ?? item
    // Only pre-game events
    if (ev.state !== 'NOT_STARTED') continue
    events.push({
      eventId: ev.id,
      name: ev.englishName || ev.name,
      homeName: ev.homeName,
      awayName: ev.awayName,
      start: ev.start,
      sport: ev.sport,
      leaguePath: sportPath,
    })
  }

  return events
}

/**
 * Fetch ALL betOffers for a batch of event IDs (paginated).
 * Kambi supports comma-separated event IDs in one call.
 */
async function fetchAllBetOffers(
  base: string,
  eventIds: number[],
  signal?: AbortSignal,
  params: string = DEFAULT_PARAMS,
): Promise<KambiBetOffer[]> {
  const idStr = eventIds.join(',')
  const allOffers: KambiBetOffer[] = []
  let start = 0

  while (true) {
    const url = `${base}/betoffer/event/${idStr}.json?${params}&range_start=${start}&range_size=${PAGE_SIZE}&includeParticipants=true`
    const resp = await fetch(url, { signal })
    if (!resp.ok) break

    const data = await resp.json()
    const offers = data.betOffers ?? []
    allOffers.push(...offers)

    if (offers.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  return allOffers
}

interface KambiBetOffer {
  id: number
  eventId: number
  criterion?: {
    label?: string
    englishLabel?: string
  }
  betOfferType?: {
    name?: string
  }
  outcomes?: KambiOutcome[]
  tags?: string[]
}

interface KambiOutcome {
  label?: string
  englishLabel?: string
  odds?: number          // decimal * 1000 (e.g. 1920 = 1.92)
  oddsAmerican?: string  // "-109"
  line?: number          // e.g. 11500 = 11.5
  participant?: string   // player name
  type?: string          // "OT_OVER", "OT_UNDER", "OT_YES", "OT_NO", "OT_ONE", "OT_TWO"
}

/**
 * Parse a batch of Kambi betOffers into normalized props.
 * Only keeps the MAIN line per player per category (first occurrence).
 * Kambi doesn't tag alternate player prop lines, so we dedup by keeping the first.
 */
function parseBetOffers(offers: KambiBetOffer[]): Map<number, NormalizedProp[]> {
  const byEvent = new Map<number, NormalizedProp[]>()
  // Track seen (event, category, player) to skip alternates
  const seenMainLine = new Set<string>()
  const seenTotalHits = new Set<number>()

  for (const offer of offers) {
    const label = offer.criterion?.englishLabel || offer.criterion?.label || ''

    // ── Game-level "Total Hits" — store as a prop (player='Game') ──
    const labelLower = label.toLowerCase().trim()
    if (labelLower === 'total hits' || labelLower === 'total hits - including extra innings') {
      if (seenTotalHits.has(offer.eventId)) continue // first/main only
      const outcomes = offer.outcomes ?? []
      let over: number | null = null
      let under: number | null = null
      let line: number | null = null
      for (const o of outcomes) {
        const am = o.oddsAmerican ? parseInt(o.oddsAmerican, 10) : null
        if (am == null || isNaN(am)) continue
        if (o.line != null && line == null) line = o.line / 1000
        const t = (o.type || '').toUpperCase()
        const lbl = (o.englishLabel || o.label || '').toLowerCase()
        if (t.includes('OVER') || lbl === 'over') over = am
        else if (t.includes('UNDER') || lbl === 'under') under = am
      }
      if (line != null && (over != null || under != null)) {
        seenTotalHits.add(offer.eventId)
        if (!byEvent.has(offer.eventId)) byEvent.set(offer.eventId, [])
        byEvent.get(offer.eventId)!.push({
          propCategory: 'game_total_hits',
          playerName: 'Game',
          lineValue: line,
          overPrice: over,
          underPrice: under,
          yesPrice: null, noPrice: null, isBinary: false,
        })
      }
      continue
    }

    const mapped = mapKambiCategory(label)
    if (!mapped) continue

    // Convert MLB home run binary markets to Over (N-0.5) home runs:
    //   "Player to Hit a Home Run"  → Over 0.5 (threshold 1)
    //   "Player to hit 2 or more Home Runs" → Over 1.5 (threshold 2)
    //   "Player to hit 3 or more Home Runs" → Over 2.5 (threshold 3)
    // This lets us cross-match against Kambi/FanDuel/Betway under lines.
    let binaryHrThreshold: number | null = null
    if (mapped.isBinary && mapped.category === 'player_home_runs') {
      const m = label.match(/hit\s+(\d+)\s+or\s+more\s+home\s+runs/i)
      if (m) binaryHrThreshold = parseInt(m[1], 10)
      else if (/player to hit a home run/i.test(label)) binaryHrThreshold = 1
    }

    // Skip other binary props — different thresholds across books make them
    // not directly comparable.
    if (mapped.isBinary && binaryHrThreshold == null) continue

    const outcomes = offer.outcomes ?? []
    if (outcomes.length === 0) continue

    // Extract player name from outcomes
    const playerRaw = outcomes[0]?.participant
    if (!playerRaw) continue
    const playerName = normalizePlayerName(playerRaw)

    // Dedup: only keep the first (main) line per player per category per event.
    // Kambi returns alternate lines without a MAIN_LINE tag for player props,
    // so the first occurrence is the primary line.
    // EXCEPTION: HR binary thresholds (0.5, 1.5, 2.5) should all be kept since
    // they represent different lines — include threshold in dedup key.
    const effectiveDedupSuffix = binaryHrThreshold != null ? `|${binaryHrThreshold}` : ''
    if (!mapped.isBinary || binaryHrThreshold != null) {
      const dedupKey = `${offer.eventId}|${mapped.category}|${playerName}${effectiveDedupSuffix}`
      if (seenMainLine.has(dedupKey)) continue
      seenMainLine.add(dedupKey)
    }

    // Parse over/under or yes/no prices
    let overPrice: number | null = null
    let underPrice: number | null = null
    let yesPrice: number | null = null
    let noPrice: number | null = null
    let lineValue: number | null = null

    for (const o of outcomes) {
      const american = o.oddsAmerican ? parseInt(o.oddsAmerican, 10) : null
      if (american == null || isNaN(american)) continue

      const lbl = (o.englishLabel || o.label || '').toLowerCase()
      const type = (o.type || '').toUpperCase()

      // Line value (Kambi stores as thousandths: 22500 = 22.5)
      if (o.line != null && lineValue == null) {
        lineValue = o.line / 1000
      }

      if (mapped.isBinary) {
        // Binary props: Yes/No or Over(Yes)/Under(No)
        if (type.includes('OVER') || type.includes('YES') || lbl === 'over' || lbl === 'yes') {
          yesPrice = american
        } else if (type.includes('UNDER') || type.includes('NO') || lbl === 'under' || lbl === 'no') {
          noPrice = american
        }
      } else {
        // Over/Under props
        if (type.includes('OVER') || lbl === 'over') {
          overPrice = american
        } else if (type.includes('UNDER') || lbl === 'under') {
          underPrice = american
        }
      }
    }

    // Must have at least one price
    if (overPrice == null && underPrice == null && yesPrice == null && noPrice == null) continue

    // For HR binary threshold markets: convert Yes → Over (threshold - 0.5)
    if (binaryHrThreshold != null && yesPrice != null) {
      overPrice = yesPrice
      underPrice = noPrice
      yesPrice = null
      noPrice = null
      lineValue = binaryHrThreshold - 0.5
    }

    const prop: NormalizedProp = {
      propCategory: mapped.category,
      playerName,
      lineValue,
      overPrice,
      underPrice,
      yesPrice,
      noPrice,
      isBinary: binaryHrThreshold != null ? false : mapped.isBinary,
    }

    if (!byEvent.has(offer.eventId)) byEvent.set(offer.eventId, [])
    byEvent.get(offer.eventId)!.push(prop)
  }

  return byEvent
}

// Game-level criterion labels
const GAME_MARKET_LABELS: Record<string, 'moneyline' | 'spread' | 'total'> = {
  'moneyline - including overtime': 'moneyline',
  'moneyline': 'moneyline',
  'point spread - including overtime': 'spread',
  'point spread': 'spread',
  'handicap': 'spread',
  'run line': 'spread',
  'run line - including extra innings': 'spread',
  'puck line - including overtime': 'spread',
  'total points - including overtime': 'total',
  'total points': 'total',
  'total runs - including extra innings': 'total',
  'total runs': 'total',
  'total goals - including overtime': 'total',
  'total goals': 'total',
  'total match goals': 'total',
}

/**
 * Parse game-level betOffers (ML, spread, total) from a batch.
 * Keeps the first offer per (event, market_type) — prefers MAIN_LINE tagged but
 * falls back to any matching offer (Kambi doesn't tag ML as MAIN_LINE).
 */
function parseGameMarkets(offers: KambiBetOffer[]): Map<number, KambiGameMarket[]> {
  const byEvent = new Map<number, KambiGameMarket[]>()
  // Track seen (event, market_type) to keep only the primary line
  const seenGameMarket = new Set<string>()

  // Sort so MAIN_LINE tagged offers come first (preferred)
  const sorted = [...offers].sort((a, b) => {
    const aMain = a.tags?.includes('MAIN_LINE') ? 0 : 1
    const bMain = b.tags?.includes('MAIN_LINE') ? 0 : 1
    return aMain - bMain
  })

  for (const offer of sorted) {
    const label = (offer.criterion?.englishLabel || offer.criterion?.label || '').toLowerCase().trim()
    const marketType = GAME_MARKET_LABELS[label]
    if (!marketType) continue

    const outcomes = offer.outcomes ?? []
    if (outcomes.length === 0) continue

    // One line per market type per event — no alternates.
    // Alternates were creating 2000+ rows per event, burning Supabase Disk IO.
    const dedupKey = `${offer.eventId}|${marketType}`
    if (seenGameMarket.has(dedupKey)) continue
    seenGameMarket.add(dedupKey)

    let homePrice: number | null = null
    let awayPrice: number | null = null
    let drawPrice: number | null = null
    let spreadValue: number | null = null
    let totalValue: number | null = null
    let overPrice: number | null = null
    let underPrice: number | null = null

    for (const o of outcomes) {
      const american = o.oddsAmerican ? parseInt(o.oddsAmerican, 10) : null
      if (american == null || isNaN(american)) continue
      const type = (o.type || '').toUpperCase()

      if (marketType === 'moneyline') {
        if (type === 'OT_ONE') homePrice = american
        else if (type === 'OT_TWO') awayPrice = american
        else if (type === 'OT_CROSS') drawPrice = american
      } else if (marketType === 'spread') {
        spreadValue = o.line != null ? o.line / 1000 : null
        if (type === 'OT_ONE') homePrice = american
        else if (type === 'OT_TWO') awayPrice = american
      } else if (marketType === 'total') {
        totalValue = o.line != null ? o.line / 1000 : null
        if (type.includes('OVER') || (o.label || '').toLowerCase() === 'over') overPrice = american
        else if (type.includes('UNDER') || (o.label || '').toLowerCase() === 'under') underPrice = american
      }
    }

    const gm: KambiGameMarket = {
      marketType, homePrice, awayPrice, drawPrice,
      spreadValue, totalValue, overPrice, underPrice,
    }

    if (!byEvent.has(offer.eventId)) byEvent.set(offer.eventId, [])
    byEvent.get(offer.eventId)!.push(gm)
  }

  return byEvent
}

export interface KambiOperatorResults {
  operator: KambiOperator
  results: KambiPropResult[]
}

/**
 * Full Kambi scrape: fetch every prop for every event across all configured
 * sports for each configured operator. CA operators share a Kambi platform
 * (shared event IDs); US operators (parx, etc.) run on their own platform
 * with distinct IDs, so we discover events per-operator to support both.
 *
 * Performance cost of per-op discovery: one listView call per sport per op
 * (~11 sports × N ops ≈ 11N extra sub-second calls). Negligible vs. the
 * bet-offer fetches.
 */
export async function scrapeAllKambiOperators(
  signal?: AbortSignal,
): Promise<KambiOperatorResults[]> {
  const allResults: KambiOperatorResults[] = []

  for (const operator of KAMBI_OPERATORS) {
    const host = operator.host ?? KAMBI_CDN
    const base = `${host}/${operator.clientId}`
    const params = `lang=${operator.lang ?? 'en_CA'}&market=${operator.market ?? 'CA-ON'}`

    // Per-operator event discovery.
    const sportEvents = await Promise.all(
      KAMBI_SPORT_PATHS.map(sp => fetchEvents(base, sp.path, params)),
    )
    const opEvents = sportEvents.flat()
    if (opEvents.length === 0) {
      allResults.push({ operator, results: [] })
      continue
    }

    // Batch events in groups of 15
    const BATCH_SIZE = 15
    const batches: KambiEvent[][] = []
    for (let i = 0; i < opEvents.length; i += BATCH_SIZE) {
      batches.push(opEvents.slice(i, i + BATCH_SIZE))
    }

    const results: KambiPropResult[] = []
    const MAX_CONCURRENT = 3
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const chunk = batches.slice(i, i + MAX_CONCURRENT)
      const batchResults = await Promise.all(
        chunk.map(async (batch) => {
          const eventIds = batch.map(e => e.eventId)
          const offers = await fetchAllBetOffers(base, eventIds, signal, params)
          const propsByEvent = parseBetOffers(offers)
          const gameMarketsByEvent = parseGameMarkets(offers)

          return batch.map(event => ({
            event,
            props: propsByEvent.get(event.eventId) ?? [],
            gameMarkets: gameMarketsByEvent.get(event.eventId) ?? [],
          }))
        }),
      )

      results.push(...batchResults.flat())
    }

    allResults.push({ operator, results })
  }

  return allResults
}

/** Backwards-compatible: scrape just the first operator (BetRivers) */
export async function scrapeKambiProps(
  signal?: AbortSignal,
): Promise<KambiPropResult[]> {
  const all = await scrapeAllKambiOperators(signal)
  return all[0]?.results ?? []
}

/**
 * Get the Kambi group ID for a sport path (used for event discovery).
 */
export async function getKambiGroupId(sportPath: string): Promise<number | null> {
  const url = `${KAMBI_CDN}/${KAMBI_OPERATORS[0].clientId}/listView/${sportPath}/all/all/matches.json?${DEFAULT_PARAMS}`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const data = await resp.json()
  return data.events?.[0]?.event?.groupId ?? null
}
