/**
 * Sportzino — US sweepstakes sportsbook running on the Altenar widget
 * platform. Altenar's /api/widget/GetTopEvents returns a normalized
 * {markets, odds, events} triple that's relatively easy to parse.
 *
 * Discovery endpoints captured:
 *   POST /api/widget/GetTopEvents               - event list + markets + odds
 *   POST /api/Widget/GetSportInfo               - sport ID → icon name
 *   POST /api/WidgetAuth/GetCountryCode         - geo check
 *   POST /api/Widget/GetWidgetsConfiguration    - layout / banners (ignore)
 *
 * Response shape (from GetTopEvents):
 *   {
 *     markets: [{ id, name, oddIds:[...], typeId, headerName, sportMarketId }]
 *     odds:    [{ id, typeId, price, competitorId, name, oddStatus }]
 *     events:  [{ id, startDate, competitors:[...], sportId, ...}]
 *   }
 *
 * Price format: decimal (2.0 = +100, 1.8 = -125). Convert to American.
 *
 * Strategy: passively capture responses from /api/widget/GetTopEvents
 * as we drive the SPA through league landing pages (which trigger the
 * call with different sport filters).
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, ScrapedEvent } from '../lib/types.js'

const SEED_URL = 'https://sportzino.com'

// Sportzino / Altenar sport IDs captured via GetSportInfo:
//   66 = soccer, 67 = basketball, 68 = tennis, 70 = ice-hockey,
//   76 = baseball, 93 (guess) = american-football
// Mapping sport-name to our canonical league slug requires per-event
// info since Altenar has multiple tournaments per sport.
const SPORT_TO_SLUG: Record<number, { sport: string; maybeLeague: string }> = {
  67: { sport: 'basketball', maybeLeague: 'nba' },
  70: { sport: 'ice_hockey', maybeLeague: 'nhl' },
  76: { sport: 'baseball',   maybeLeague: 'mlb' },
}

function decimalToAmerican(d: number): number | null {
  if (!Number.isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

interface AltenarEvent {
  id: number
  sportId: number
  startDate?: string
  start?: string
  competitors?: Array<{ id: number; name: string; homeAway?: string; isHome?: boolean }>
  name?: string
  leagueName?: string
  tournament?: { name?: string }
}

interface AltenarMarket {
  id: number
  name: string
  oddIds: number[]
  typeId: number
  eventId?: number
}

interface AltenarOdd {
  id: number
  typeId: number
  price: number
  competitorId?: number
  name: string
  oddStatus?: number
}

interface AltenarResponse {
  events?: AltenarEvent[]
  markets?: AltenarMarket[]
  odds?: AltenarOdd[]
}

/** Walk one GetTopEvents body and join events → markets → odds. */
function buildScraped(body: AltenarResponse): ScrapedEvent[] {
  const events = body?.events ?? []
  const markets = body?.markets ?? []
  const odds = body?.odds ?? []
  if (events.length === 0 || markets.length === 0 || odds.length === 0) return []

  const oddById = new Map<number, AltenarOdd>()
  for (const o of odds) oddById.set(o.id, o)

  // Markets don't always inline eventId — many Altenar variants put it
  // as a foreign key on the event instead. Cross-index both ways.
  const marketsByEvent = new Map<number, AltenarMarket[]>()
  for (const m of markets) {
    const evId = m.eventId ?? (m as any).eId ?? (m as any).eventID
    if (typeof evId === 'number') {
      if (!marketsByEvent.has(evId)) marketsByEvent.set(evId, [])
      marketsByEvent.get(evId)!.push(m)
    }
  }

  const out: ScrapedEvent[] = []
  for (const ev of events) {
    const meta = SPORT_TO_SLUG[ev.sportId]
    if (!meta) continue   // skip non-US-major sports for now

    const start = ev.startDate ?? ev.start
    if (!start) continue
    const startTime = new Date(start).toISOString()

    const competitors = ev.competitors ?? []
    if (competitors.length < 2) continue
    const home = competitors.find(c => c.isHome === true || c.homeAway === 'home') ?? competitors[0]
    const away = competitors.find(c => c !== home) ?? competitors[1]
    if (!home?.name || !away?.name) continue

    const evMarkets = marketsByEvent.get(ev.id) ?? []
    const gameMarkets: GameMarket[] = []

    for (const m of evMarkets) {
      const ids = m.oddIds ?? []
      const related = ids.map(id => oddById.get(id)).filter(Boolean) as AltenarOdd[]
      if (related.length < 2) continue

      const name = String(m.name ?? '').toLowerCase()
      if (/money/.test(name)) {
        const homeOdd = related.find(o => o.competitorId === home.id)
        const awayOdd = related.find(o => o.competitorId === away.id)
        const hp = homeOdd ? decimalToAmerican(homeOdd.price) : null
        const ap = awayOdd ? decimalToAmerican(awayOdd.price) : null
        if (hp == null && ap == null) continue
        gameMarkets.push({
          marketType: 'moneyline',
          homePrice: hp, awayPrice: ap, drawPrice: null,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      } else if (/spread|handicap/.test(name)) {
        const homeOdd = related.find(o => o.competitorId === home.id)
        const awayOdd = related.find(o => o.competitorId === away.id)
        const hp = homeOdd ? decimalToAmerican(homeOdd.price) : null
        const ap = awayOdd ? decimalToAmerican(awayOdd.price) : null
        const line = (homeOdd as any)?.sbv ?? (homeOdd as any)?.line ?? null
        if (hp == null && ap == null) continue
        gameMarkets.push({
          marketType: 'spread',
          homePrice: hp, awayPrice: ap, drawPrice: null,
          spreadValue: typeof line === 'number' ? line : null,
          totalValue: null, overPrice: null, underPrice: null,
        })
      } else if (/total|over.*under/i.test(name)) {
        const over  = related.find(o => /over/i.test(o.name))
        const under = related.find(o => /under/i.test(o.name))
        const op = over  ? decimalToAmerican(over.price)  : null
        const up = under ? decimalToAmerican(under.price) : null
        const line = (over as any)?.sbv ?? (over as any)?.line ?? null
        if (op == null && up == null) continue
        gameMarkets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null,
          spreadValue: null,
          totalValue: typeof line === 'number' ? line : null,
          overPrice: op, underPrice: up,
        })
      }
    }

    if (gameMarkets.length === 0) continue
    out.push({
      event: {
        externalId: String(ev.id),
        homeTeam: home.name,
        awayTeam: away.name,
        startTime,
        leagueSlug: meta.maybeLeague,
        sport: meta.sport,
      },
      gameMarkets,
      props: [],
    })
  }
  return out
}

export const sportzinoAdapter: BookAdapter = {
  slug: 'sportzino',
  name: 'Sportzino',
  pollIntervalSec: 7200,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const responseBodies: AltenarResponse[] = []

      page.on('response', async (resp) => {
        const u = resp.url()
        if (resp.status() !== 200) return
        if (!/\/api\/widget\/GetTopEvents/i.test(u)) return
        try {
          const body = await resp.json()
          responseBodies.push(body)
        } catch { /* non-JSON */ }
      })

      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(4_000)
      } catch (e: any) {
        log.error('seed failed', { url: SEED_URL, message: e?.message ?? String(e) })
        errors.push(`seed: ${e?.message ?? String(e)}`)
        return { events: [], errors }
      }

      for (const path of ['/sportsbook/nba', '/sportsbook/mlb', '/sportsbook/nhl']) {
        if (signal.aborted) break
        try {
          await page.goto(SEED_URL + path, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          await page.waitForTimeout(4_000)
        } catch (e: any) {
          errors.push(`${path} nav: ${e?.message ?? String(e)}`)
        }
      }

      // Merge all captured bodies and build ScrapedEvents.
      const scraped: ScrapedEvent[] = []
      const seen = new Set<string>()
      for (const body of responseBodies) {
        for (const ev of buildScraped(body)) {
          const key = ev.event.externalId ?? `${ev.event.leagueSlug}|${ev.event.homeTeam}|${ev.event.awayTeam}`
          if (seen.has(key)) continue
          seen.add(key)
          scraped.push(ev)
        }
      }

      log.info('sportzino capture', {
        responseCount: responseBodies.length,
        emitted: scraped.length,
        perLeague: scraped.reduce((acc, e) => {
          acc[e.event.leagueSlug] = (acc[e.event.leagueSlug] ?? 0) + 1
          return acc
        }, {} as Record<string, number>),
      })
      return { events: scraped, errors }
    }, { useProxy: false })
  },
}
