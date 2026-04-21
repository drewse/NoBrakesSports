/**
 * BetRivers (Ontario) — real adapter (Kambi rsicaon).
 *
 * Confirmed via discovery capture: the SPA fires
 *   https://eu.offering-api.kambicdn.com/offering/v2018/rsicaon/group.json
 *   https://eu1.offering-api.kambicdn.com/offering/v2018/rsicaon/betoffer/event/{ids}.json
 * All public (no auth), ~100KB+ for group, ~53KB per page of betoffers.
 *
 * Strategy:
 *   1. GET .../group.json → walk nested groups to find NBA/MLB/NHL events
 *      by league name; collect eventIds.
 *   2. Batch the eventIds into comma-separated chunks, GET
 *      .../betoffer/event/{ids}.json for main lines.
 *
 * We can hit Kambi directly from Railway (no CF), but we still call from
 * inside a Chromium context to sidestep any per-IP rate caps.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket } from '../lib/types.js'

const CLIENT = 'rsicaon'
const GROUP_URL = `https://eu.offering-api.kambicdn.com/offering/v2018/${CLIENT}/group.json?lang=en_CA&market=CA-ON`
const BETOFFER_BASE = `https://eu1.offering-api.kambicdn.com/offering/v2018/${CLIENT}/betoffer/event`

interface KLeagueConfig {
  termKey: string          // Kambi league code as it appears in group.json
  leagueSlug: string
  sport: string
}

const LEAGUES: KLeagueConfig[] = [
  { termKey: 'nba',        leagueSlug: 'nba', sport: 'basketball' },
  { termKey: 'mlb',        leagueSlug: 'mlb', sport: 'baseball'   },
  { termKey: 'nhl',        leagueSlug: 'nhl', sport: 'ice_hockey' },
  { termKey: 'premier_league', leagueSlug: 'epl', sport: 'soccer' },
  { termKey: 'la_liga',    leagueSlug: 'laliga',     sport: 'soccer' },
  { termKey: 'bundesliga', leagueSlug: 'bundesliga', sport: 'soccer' },
  { termKey: 'serie_a',    leagueSlug: 'seria_a',    sport: 'soccer' },
  { termKey: 'ligue_1',    leagueSlug: 'ligue_one',  sport: 'soccer' },
]

interface KGroup {
  id: number
  name?: string
  termKey?: string
  englishName?: string
  sport?: string
  eventCount?: number
  groups?: KGroup[]
  events?: KEvent[]
}

interface KEvent {
  id: number
  name?: string
  homeName?: string
  awayName?: string
  start?: string
  state?: string
  group?: string
  groupId?: number
}

interface KOutcome {
  id: number
  label?: string
  englishLabel?: string
  odds?: number          // decimal × 1000
  oddsAmerican?: string
  line?: number
  participant?: string
  type?: string          // OT_ONE / OT_TWO / OT_OVER / OT_UNDER / OT_CROSS
}

interface KBetOffer {
  id: number
  eventId: number
  criterion?: { id?: number; label?: string; englishLabel?: string }
  betOfferType?: { id?: number; name?: string; englishName?: string }
  outcomes?: KOutcome[]
  main?: boolean
}

/** Kambi encodes decimal odds as odds*1000 (e.g. 1910 = 1.91 = -110). */
function kambiToAmerican(o: KOutcome | undefined): number | null {
  if (!o) return null
  if (o.oddsAmerican) {
    const n = parseInt(o.oddsAmerican.replace(/^\+/, ''), 10)
    return isNaN(n) ? null : n
  }
  if (typeof o.odds === 'number' && o.odds > 1000) {
    const decimal = o.odds / 1000
    if (decimal >= 2) return Math.round((decimal - 1) * 100)
    return Math.round(-100 / (decimal - 1))
  }
  return null
}

/** Walk the group tree looking for a node whose termKey or name matches. */
function findLeagueGroup(tree: KGroup, termKey: string): KGroup | null {
  const target = termKey.toLowerCase()
  const walk = (node: KGroup): KGroup | null => {
    if (!node) return null
    const tk = (node.termKey ?? '').toLowerCase()
    const en = (node.englishName ?? '').toLowerCase().replace(/\s+/g, '_')
    if (tk === target || en === target) return node
    for (const child of node.groups ?? []) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(tree)
}

/** Recursively collect eventIds under a group — Kambi nests tournaments
 *  under leagues, and each tournament carries its own events array. */
async function collectEventIds(
  league: KLeagueConfig,
  pageFetch: (url: string) => Promise<{ status: number; text: string }>,
): Promise<number[]> {
  // Per-league listview endpoint — returns all events for that league flat.
  const url =
    `https://eu.offering-api.kambicdn.com/offering/v2018/${CLIENT}/listView/`
    + `all/all/all/${league.termKey}/all/matches.json?lang=en_CA&market=CA-ON`
  const { status, text } = await pageFetch(url)
  if (status !== 200) return []
  try {
    const body = JSON.parse(text)
    const events: KEvent[] = body.events ?? []
    return events
      .filter(e => e.state !== 'FINISHED' && e.state !== 'STARTED')
      .map(e => e.id)
  } catch { return [] }
}

export const betriversAdapter: BookAdapter = {
  slug: 'betrivers_on',
  name: 'BetRivers (Ontario)',
  pollIntervalSec: 180,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []
      const eventsById = new Map<number, KEvent & { league: KLeagueConfig }>()

      // Minimal seed so the page has a document context for fetch().
      try {
        await page.goto('https://on.betrivers.ca/', {
          waitUntil: 'domcontentloaded', timeout: 30_000,
        })
      } catch { /* proceed — Kambi endpoints don't need cookies */ }

      const pageFetch = async (url: string): Promise<{ status: number; text: string }> => {
        return page.evaluate(async (u: string) => {
          try {
            const r = await fetch(u, {
              headers: { Accept: 'application/json' },
            })
            return { status: r.status, text: await r.text() }
          } catch (e: any) {
            return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
          }
        }, url)
      }

      // 1) Pull group tree (one call) for event metadata (names, start time).
      //    listView endpoints return events flat per league which is what we
      //    actually want — collect IDs in parallel.
      await Promise.all(LEAGUES.map(async (league) => {
        const ids = await collectEventIds(league, pageFetch)
        // Fetch event metadata from the listview body (already has it).
        const url =
          `https://eu.offering-api.kambicdn.com/offering/v2018/${CLIENT}/listView/`
          + `all/all/all/${league.termKey}/all/matches.json?lang=en_CA&market=CA-ON`
        const { status, text } = await pageFetch(url)
        if (status !== 200) {
          log.warn('betrivers listview failed', { league: league.termKey, status })
          errors.push(`${league.termKey} listView HTTP ${status}`)
          return
        }
        try {
          const body = JSON.parse(text)
          for (const e of body.events ?? []) {
            if (!ids.includes(e.id)) continue
            eventsById.set(e.id, { ...e, league })
          }
        } catch {
          errors.push(`${league.termKey} listView non-JSON`)
        }
      }))

      log.info('betrivers events collected', { count: eventsById.size })
      if (eventsById.size === 0) return { events: scraped, errors }

      // 2) Batch betoffer lookups. Kambi accepts up to ~40 ids per URL before
      //    the URL line length starts causing 414s.
      const ids = [...eventsById.keys()]
      const BATCH = 40
      const offersByEvent = new Map<number, KBetOffer[]>()
      for (let i = 0; i < ids.length; i += BATCH) {
        if (signal.aborted) break
        const chunk = ids.slice(i, i + BATCH).join(',')
        const url = `${BETOFFER_BASE}/${chunk}.json?lang=en_CA&market=CA-ON&includeParticipants=true`
        const { status, text } = await pageFetch(url)
        if (status !== 200) {
          errors.push(`betoffer batch HTTP ${status}`)
          continue
        }
        try {
          const body = JSON.parse(text)
          for (const bo of body.betOffers ?? []) {
            const list = offersByEvent.get(bo.eventId) ?? []
            list.push(bo)
            offersByEvent.set(bo.eventId, list)
          }
        } catch {
          errors.push('betoffer batch non-JSON')
        }
      }

      // 3) Normalize into events + main lines.
      for (const [eventId, meta] of eventsById) {
        if (!meta.homeName || !meta.awayName) continue
        const offers = offersByEvent.get(eventId) ?? []
        const gameMarkets: GameMarket[] = []

        const ml = offers.find(o =>
          o.betOfferType?.englishName === 'Match'
          || o.criterion?.englishLabel === 'Full Time')
        if (ml) {
          const home = ml.outcomes?.find(o => o.type === 'OT_ONE')
          const away = ml.outcomes?.find(o => o.type === 'OT_TWO')
          const draw = ml.outcomes?.find(o => o.type === 'OT_CROSS')
          gameMarkets.push({
            marketType: 'moneyline',
            homePrice: kambiToAmerican(home),
            awayPrice: kambiToAmerican(away),
            drawPrice: kambiToAmerican(draw),
            spreadValue: null, totalValue: null,
            overPrice: null, underPrice: null,
          })
        }

        const spread = offers.find(o =>
          o.betOfferType?.englishName === 'Handicap'
          || (o.criterion?.englishLabel ?? '').toLowerCase().includes('handicap'))
        if (spread) {
          const home = spread.outcomes?.find(o => o.type === 'OT_ONE')
          const away = spread.outcomes?.find(o => o.type === 'OT_TWO')
          const rawLine = home?.line ?? (away?.line != null ? -(away.line) : null)
          // Kambi lines are in thousandths of a point (e.g. -1500 = -1.5).
          const spreadValue = rawLine != null ? rawLine / 1000 : null
          gameMarkets.push({
            marketType: 'spread',
            homePrice: kambiToAmerican(home),
            awayPrice: kambiToAmerican(away),
            drawPrice: null,
            spreadValue,
            totalValue: null, overPrice: null, underPrice: null,
          })
        }

        const total = offers.find(o =>
          o.betOfferType?.englishName === 'Over/Under'
          || (o.criterion?.englishLabel ?? '').toLowerCase().includes('total'))
        if (total) {
          const over = total.outcomes?.find(o => o.type === 'OT_OVER')
          const under = total.outcomes?.find(o => o.type === 'OT_UNDER')
          const rawLine = over?.line ?? under?.line ?? null
          const totalValue = rawLine != null ? rawLine / 1000 : null
          gameMarkets.push({
            marketType: 'total',
            homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
            totalValue,
            overPrice: kambiToAmerican(over),
            underPrice: kambiToAmerican(under),
          })
        }

        if (gameMarkets.length === 0) continue
        scraped.push({
          event: {
            externalId: String(eventId),
            homeTeam: meta.homeName,
            awayTeam: meta.awayName,
            startTime: meta.start ?? '',
            leagueSlug: meta.league.leagueSlug,
            sport: meta.league.sport,
          },
          gameMarkets,
          props: [],
        })
      }

      log.info('betrivers scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
