/**
 * Bally Bet (Ontario) — real adapter (Kambi white-label).
 *
 * Confirmed via DevTools curl:
 *   Base:    https://eu1.offering-api.kambicdn.com/offering/v2018/bcscaon
 *   Client:  bcscaon   (Bally Canada Sports CA-ON)
 *   ListView: /listView/{sport}/{league}/all/all/competitions.json
 *   Origin:  https://play.ballybet.ca  (referer)
 *   Market:  CA-ON, lang: en_US (yes — Bally uses en_US for CA; confirmed)
 *
 * Same Kambi offering-api surface as BetRivers / Proline. Different
 * regional host (eu1.offering-api).
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket } from '../lib/types.js'

const CLIENT = 'bcscaon'
const KAMBI_HOST = 'https://eu1.offering-api.kambicdn.com'
const BETOFFER_BASE = `${KAMBI_HOST}/offering/v2018/${CLIENT}/betoffer/event`
const ORIGIN = 'https://play.ballybet.ca'

interface KLeagueConfig {
  termKey: string
  leagueSlug: string
  sport: string
  sportPath: string
  leaguePath: string
}

// Soccer leagues 404 on the BCS client — Kambi league slugs differ per
// white-label. Sticking to NBA / MLB / NHL which the curl confirmed.
const LEAGUES: KLeagueConfig[] = [
  { termKey: 'nba', leagueSlug: 'nba', sport: 'basketball', sportPath: 'basketball', leaguePath: 'nba' },
  { termKey: 'mlb', leagueSlug: 'mlb', sport: 'baseball',   sportPath: 'baseball',   leaguePath: 'mlb' },
  { termKey: 'nhl', leagueSlug: 'nhl', sport: 'ice_hockey', sportPath: 'ice_hockey', leaguePath: 'nhl' },
]

interface KEvent {
  id: number
  name?: string
  homeName?: string
  awayName?: string
  start?: string
  state?: string
}

interface KOutcome {
  id: number
  label?: string
  englishLabel?: string
  odds?: number
  oddsAmerican?: string
  line?: number
  participant?: string
  type?: string
}

interface KBetOffer {
  id: number
  eventId: number
  criterion?: { id?: number; label?: string; englishLabel?: string }
  betOfferType?: { id?: number; name?: string; englishName?: string }
  outcomes?: KOutcome[]
  main?: boolean
}

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

export const ballybetAdapter: BookAdapter = {
  slug: 'ballybet',
  name: 'Bally Bet (Ontario)',
  pollIntervalSec: 180,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []
      const eventsById = new Map<number, KEvent & { league: KLeagueConfig }>()

      // Seed play.ballybet.ca so fetch origin/referer matches. The SPA can
      // be slow to load but we only need a document context for fetch().
      try {
        await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      } catch { /* proceed — endpoints are public */ }

      const pageFetch = async (url: string): Promise<{ status: number; text: string }> => {
        return page.evaluate(async (u: string) => {
          try {
            const r = await fetch(u, { headers: { Accept: '*/*' } })
            return { status: r.status, text: await r.text() }
          } catch (e: any) {
            return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
          }
        }, url)
      }

      // 1) Pull event lists per league in parallel.
      //    Kambi's listView wraps each row as { event: {...}, betOffers: [...] }
      //    — event metadata only here; betoffers fetched in step 2.
      await Promise.all(LEAGUES.map(async (league) => {
        const url =
          `${KAMBI_HOST}/offering/v2018/${CLIENT}/listView/`
          + `${league.sportPath}/${league.leaguePath}/all/all/matches.json`
          + `?channel_id=1&client_id=200&lang=en_US&market=CA-ON&useCombined=true&useCombinedLive=true`
        const { status, text } = await pageFetch(url)
        if (status !== 200) {
          log.warn('ballybet listview failed', { league: league.termKey, status })
          errors.push(`${league.termKey} listView HTTP ${status}`)
          return
        }
        try {
          const body = JSON.parse(text)
          const rows: Array<{ event: KEvent }> = Array.isArray(body.events) ? body.events : []
          for (const row of rows) {
            const e = row?.event
            if (!e || !e.id) continue
            if (e.state === 'FINISHED' || e.state === 'STARTED') continue
            eventsById.set(e.id, { ...e, league })
          }
        } catch {
          errors.push(`${league.termKey} listView non-JSON`)
        }
      }))

      log.info('ballybet events collected', { count: eventsById.size })
      if (eventsById.size === 0) return { events: scraped, errors }

      // 2) Batch betoffer lookups (Kambi accepts ~40 ids per URL).
      const ids = [...eventsById.keys()]
      const BATCH = 40
      const offersByEvent = new Map<number, KBetOffer[]>()
      for (let i = 0; i < ids.length; i += BATCH) {
        if (signal.aborted) break
        const chunk = ids.slice(i, i + BATCH).join(',')
        const url = `${BETOFFER_BASE}/${chunk}.json?lang=en_US&market=CA-ON&includeParticipants=true`
        const { status, text } = await pageFetch(url)
        if (status !== 200) { errors.push(`betoffer batch HTTP ${status}`); continue }
        try {
          const body = JSON.parse(text)
          for (const bo of body.betOffers ?? []) {
            const list = offersByEvent.get(bo.eventId) ?? []
            list.push(bo); offersByEvent.set(bo.eventId, list)
          }
        } catch { errors.push('betoffer batch non-JSON') }
      }

      // 3) Normalize.
      for (const [eventId, meta] of eventsById) {
        if (!meta.homeName || !meta.awayName) continue
        const offers = offersByEvent.get(eventId) ?? []
        const gameMarkets: GameMarket[] = []

        const ml = offers.find(o => {
          const bName = (o.betOfferType?.englishName ?? '').toLowerCase()
          const cLabel = (o.criterion?.englishLabel ?? '').toLowerCase()
          if (bName === 'match' || bName === 'money line' || bName === 'moneyline' || bName === 'winner') return true
          if (cLabel === 'full time' || cLabel.includes('moneyline') || cLabel.includes('money line')) return true
          return false
        })
        if (ml) {
          const home = ml.outcomes?.find(o => o.type === 'OT_ONE')
          const away = ml.outcomes?.find(o => o.type === 'OT_TWO')
          const draw = ml.outcomes?.find(o => o.type === 'OT_CROSS')
          gameMarkets.push({
            marketType: 'moneyline',
            homePrice: kambiToAmerican(home), awayPrice: kambiToAmerican(away),
            drawPrice: kambiToAmerican(draw),
            spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
          })
        }

        const spread = offers.find(o =>
          o.betOfferType?.englishName === 'Handicap'
          || (o.criterion?.englishLabel ?? '').toLowerCase().includes('handicap'))
        if (spread) {
          const home = spread.outcomes?.find(o => o.type === 'OT_ONE')
          const away = spread.outcomes?.find(o => o.type === 'OT_TWO')
          const rawLine = home?.line ?? (away?.line != null ? -(away.line) : null)
          const spreadValue = rawLine != null ? rawLine / 1000 : null
          gameMarkets.push({
            marketType: 'spread',
            homePrice: kambiToAmerican(home), awayPrice: kambiToAmerican(away),
            drawPrice: null, spreadValue,
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
            overPrice: kambiToAmerican(over), underPrice: kambiToAmerican(under),
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

      log.info('ballybet scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
