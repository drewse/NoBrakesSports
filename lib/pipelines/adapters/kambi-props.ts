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

const BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/rsicaon'
const PARAMS = 'lang=en_CA&market=CA-ON'
const PAGE_SIZE = 2000

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

export interface KambiPropResult {
  event: KambiEvent
  props: NormalizedProp[]
}

/**
 * Discover all upcoming events for a sport path.
 */
async function fetchEvents(sportPath: string): Promise<KambiEvent[]> {
  const url = `${BASE}/event/group.json?${PARAMS}&sport=${sportPath}`
  const resp = await fetch(url)
  if (!resp.ok) return []

  const data = await resp.json()
  const events: KambiEvent[] = []

  for (const ev of data.events ?? []) {
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
  eventIds: number[],
  signal?: AbortSignal,
): Promise<KambiBetOffer[]> {
  const idStr = eventIds.join(',')
  const allOffers: KambiBetOffer[] = []
  let start = 0

  while (true) {
    const url = `${BASE}/betoffer/event/${idStr}.json?${PARAMS}&range_start=${start}&range_size=${PAGE_SIZE}&includeParticipants=true`
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

/**
 * Full Kambi scrape: fetch every prop for every event across all configured sports.
 *
 * Returns a map of Kambi event ID → { event metadata, normalized props }.
 * Caller is responsible for matching Kambi events to DB events.
 */
export async function scrapeKambiProps(
  signal?: AbortSignal,
): Promise<KambiPropResult[]> {
  const results: KambiPropResult[] = []

  // Fetch events for all sports in parallel
  const sportEvents = await Promise.all(
    KAMBI_SPORT_PATHS.map(async (sp) => {
      const events = await fetchEvents(sp.path)
      return events
    })
  )

  const allEvents = sportEvents.flat()
  if (allEvents.length === 0) return results

  // Batch events in groups of 15 (to keep URL length reasonable)
  const BATCH_SIZE = 15
  const batches: KambiEvent[][] = []
  for (let i = 0; i < allEvents.length; i += BATCH_SIZE) {
    batches.push(allEvents.slice(i, i + BATCH_SIZE))
  }

  // Process batches with concurrency limit of 3
  const MAX_CONCURRENT = 3
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT) {
    const chunk = batches.slice(i, i + MAX_CONCURRENT)
    const batchResults = await Promise.all(
      chunk.map(async (batch) => {
        const eventIds = batch.map(e => e.eventId)
        const offers = await fetchAllBetOffers(eventIds, signal)
        const propsByEvent = parseBetOffers(offers)

        return batch.map(event => ({
          event,
          props: propsByEvent.get(event.eventId) ?? [],
        }))
      })
    )

    results.push(...batchResults.flat())
  }

  return results
}

/**
 * Get the Kambi group ID for a sport path (used for event discovery).
 */
export async function getKambiGroupId(sportPath: string): Promise<number | null> {
  const url = `${BASE}/listView/${sportPath}/all/all/matches.json?${PARAMS}`
  const resp = await fetch(url)
  if (!resp.ok) return null
  const data = await resp.json()
  return data.events?.[0]?.event?.groupId ?? null
}
