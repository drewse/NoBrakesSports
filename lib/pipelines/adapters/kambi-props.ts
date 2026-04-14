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

// Kambi operators with confirmed public API access and distinct odds
export const KAMBI_OPERATORS: { clientId: string; sourceSlug: string; displayName: string }[] = [
  { clientId: 'rsicaon',      sourceSlug: 'betrivers',    displayName: 'BetRivers (Ontario)' },
  { clientId: 'ubca',         sourceSlug: 'unibet',       displayName: 'Unibet CA' },
  { clientId: 'leose',        sourceSlug: 'leovegas',     displayName: 'LeoVegas' },
  { clientId: 'torstarcaon',  sourceSlug: 'northstarbets', displayName: 'NorthStar Bets' },
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
async function fetchEvents(base: string, sportPath: string): Promise<KambiEvent[]> {
  const url = `${base}/listView/${sportPath}/all/all/matches.json?${DEFAULT_PARAMS}`
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
): Promise<KambiBetOffer[]> {
  const idStr = eventIds.join(',')
  const allOffers: KambiBetOffer[] = []
  let start = 0

  while (true) {
    const url = `${base}/betoffer/event/${idStr}.json?${DEFAULT_PARAMS}&range_start=${start}&range_size=${PAGE_SIZE}&includeParticipants=true`
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

  for (const offer of offers) {
    const label = offer.criterion?.englishLabel || offer.criterion?.label || ''
    const mapped = mapKambiCategory(label)
    if (!mapped) continue

    // Skip binary props (20+ Points, anytime scorer, double-double).
    // These are threshold yes/no bets — not comparable cross-book since each
    // book offers different thresholds. Only over/under lines are useful for arb detection.
    if (mapped.isBinary) continue

    const outcomes = offer.outcomes ?? []
    if (outcomes.length === 0) continue

    // Extract player name from outcomes
    const playerRaw = outcomes[0]?.participant
    if (!playerRaw) continue
    const playerName = normalizePlayerName(playerRaw)

    // Dedup: only keep the first (main) line per player per category per event.
    // Kambi returns alternate lines without a MAIN_LINE tag for player props,
    // so the first occurrence is the primary line.
    if (!mapped.isBinary) {
      const dedupKey = `${offer.eventId}|${mapped.category}|${playerName}`
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

    const prop: NormalizedProp = {
      propCategory: mapped.category,
      playerName,
      lineValue,
      overPrice,
      underPrice,
      yesPrice,
      noPrice,
      isBinary: mapped.isBinary,
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
  operator: { clientId: string; sourceSlug: string; displayName: string }
  results: KambiPropResult[]
}

/**
 * Full Kambi scrape: fetch every prop for every event across all configured sports
 * and ALL Kambi operators (BetRivers, Unibet, LeoVegas).
 *
 * Each operator may return different odds for the same events.
 * Event IDs are shared across operators (Kambi platform-level), but prices differ.
 */
export async function scrapeAllKambiOperators(
  signal?: AbortSignal,
): Promise<KambiOperatorResults[]> {
  const allResults: KambiOperatorResults[] = []

  // Discover events once (same events across all operators)
  const base0 = `${KAMBI_CDN}/${KAMBI_OPERATORS[0].clientId}`
  const sportEvents = await Promise.all(
    KAMBI_SPORT_PATHS.map(async (sp) => {
      const events = await fetchEvents(base0, sp.path)
      return events
    })
  )

  const allEvents = sportEvents.flat()
  if (allEvents.length === 0) return allResults

  // For each operator, fetch betOffers (prices differ per operator)
  for (const operator of KAMBI_OPERATORS) {
    const base = `${KAMBI_CDN}/${operator.clientId}`
    const results: KambiPropResult[] = []

    // Batch events in groups of 15
    const BATCH_SIZE = 15
    const batches: KambiEvent[][] = []
    for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
      batches.push(allEvents.slice(i, i + BATCH_SIZE))
    }

    const MAX_CONCURRENT = 3
    for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
      const chunk = batches.slice(i, i + MAX_CONCURRENT)
      const batchResults = await Promise.all(
        chunk.map(async (batch) => {
          const eventIds = batch.map(e => e.eventId)
          const offers = await fetchAllBetOffers(base, eventIds, signal)
          const propsByEvent = parseBetOffers(offers)
          const gameMarketsByEvent = parseGameMarkets(offers)

          return batch.map(event => ({
            event,
            props: propsByEvent.get(event.eventId) ?? [],
            gameMarkets: gameMarketsByEvent.get(event.eventId) ?? [],
          }))
        })
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
