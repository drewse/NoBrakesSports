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
import { hydrateTeamName } from '../lib/team-abbr.js'
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
  competitorIds: number[]      // [awayId, homeId] — matches "Away @ Home" name
  name?: string                // "NY Yankees @ BOS Red Sox"
  marketIds?: number[]         // event → markets (NOT market → event)
  status?: number
}

interface AltenarMarket {
  id: number
  name: string
  oddIds: number[]
  typeId: number
  sbv?: number | string        // sportsbook value = handicap / total line
}

interface AltenarOdd {
  id: number
  typeId: number
  price: number                // decimal odds
  competitorId?: number        // may be absent on over/under odds
  name: string                 // team name ("BOS Red Sox") or "Over" / "Under"
  oddStatus?: number
  sbv?: number | string
}

interface AltenarResponse {
  events?: AltenarEvent[]
  markets?: AltenarMarket[]
  odds?: AltenarOdd[]
}

/** Walk one GetTopEvents body and join events → markets → odds.
 *  Real shape: events carry competitorIds[] + name, marketIds[] points at
 *  the markets[] list, each market's oddIds[] references odds[]. */
function buildScraped(body: AltenarResponse): ScrapedEvent[] {
  const events = body?.events ?? []
  const markets = body?.markets ?? []
  const odds = body?.odds ?? []
  if (events.length === 0 || markets.length === 0 || odds.length === 0) return []

  const oddById = new Map<number, AltenarOdd>()
  for (const o of odds) oddById.set(o.id, o)
  const marketById = new Map<number, AltenarMarket>()
  for (const m of markets) marketById.set(m.id, m)

  // Build competitorId → name from the odds list (odds carry the
  // team name on moneyline markets: "BOS Red Sox").
  const competitorName = new Map<number, string>()
  for (const o of odds) {
    if (o.competitorId && o.name) competitorName.set(o.competitorId, o.name)
  }

  const out: ScrapedEvent[] = []
  for (const ev of events) {
    const meta = SPORT_TO_SLUG[ev.sportId]
    if (!meta) continue

    const start = ev.startDate
    if (!start) continue
    const startTime = new Date(start).toISOString()

    const cIds = ev.competitorIds ?? []
    if (cIds.length < 2) continue
    // competitorIds[0] = away, competitorIds[1] = home
    // (verified from sample: "NY Yankees @ BOS Red Sox" with
    //  competitorIds=[50118,50121] → away=Yankees(50118), home=Red Sox(50121))
    const awayId = cIds[0]
    const homeId = cIds[1]
    let awayName = competitorName.get(awayId)
    let homeName = competitorName.get(homeId)

    // Fallback: parse from event.name ("Away @ Home")
    if ((!awayName || !homeName) && typeof ev.name === 'string') {
      const at = ev.name.indexOf(' @ ')
      if (at > 0) {
        awayName = awayName ?? ev.name.slice(0, at).trim()
        homeName = homeName ?? ev.name.slice(at + 3).trim()
      }
    }
    if (!awayName || !homeName) continue

    const gameMarkets: GameMarket[] = []
    for (const mid of ev.marketIds ?? []) {
      const m = marketById.get(mid)
      if (!m) continue
      const related = (m.oddIds ?? []).map(id => oddById.get(id)).filter(Boolean) as AltenarOdd[]
      if (related.length < 2) continue

      const name = String(m.name ?? '').toLowerCase()

      if (/money\s*line|moneyline/.test(name)) {
        const homeOdd = related.find(o => o.competitorId === homeId)
        const awayOdd = related.find(o => o.competitorId === awayId)
        const hp = homeOdd ? decimalToAmerican(homeOdd.price) : null
        const ap = awayOdd ? decimalToAmerican(awayOdd.price) : null
        if (hp == null && ap == null) continue
        gameMarkets.push({
          marketType: 'moneyline',
          homePrice: hp, awayPrice: ap, drawPrice: null,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      } else if (/spread|handicap|run\s*line|puck\s*line/.test(name)) {
        const homeOdd = related.find(o => o.competitorId === homeId)
        const awayOdd = related.find(o => o.competitorId === awayId)
        const hp = homeOdd ? decimalToAmerican(homeOdd.price) : null
        const ap = awayOdd ? decimalToAmerican(awayOdd.price) : null
        const lineRaw = homeOdd?.sbv ?? m.sbv
        const line = typeof lineRaw === 'number' ? lineRaw
          : typeof lineRaw === 'string' ? parseFloat(lineRaw) : null
        if (hp == null && ap == null) continue
        gameMarkets.push({
          marketType: 'spread',
          homePrice: hp, awayPrice: ap, drawPrice: null,
          spreadValue: Number.isFinite(line as number) ? (line as number) : null,
          totalValue: null, overPrice: null, underPrice: null,
        })
      } else if (/total|over\/under|over.*under/.test(name)) {
        const over = related.find(o => /^over/i.test(o.name))
        const under = related.find(o => /^under/i.test(o.name))
        const op = over ? decimalToAmerican(over.price) : null
        const up = under ? decimalToAmerican(under.price) : null
        const lineRaw = over?.sbv ?? m.sbv
        const line = typeof lineRaw === 'number' ? lineRaw
          : typeof lineRaw === 'string' ? parseFloat(lineRaw) : null
        if (op == null && up == null) continue
        gameMarkets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null,
          spreadValue: null,
          totalValue: Number.isFinite(line as number) ? (line as number) : null,
          overPrice: op, underPrice: up,
        })
      }
    }

    if (gameMarkets.length === 0) continue

    // Hydrate Sportzino's half-abbreviated names ("BOS Red Sox" →
    // "Boston Red Sox", "NY Yankees" → "New York Yankees") so the
    // writer matches canonical events instead of auto-creating stubs.
    const hydratedHome = hydrateTeamName(homeName, meta.maybeLeague)
    const hydratedAway = hydrateTeamName(awayName, meta.maybeLeague)

    out.push({
      event: {
        externalId: String(ev.id),
        homeTeam: hydratedHome,
        awayTeam: hydratedAway,
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
  // 1h during bring-up so parser iterations get feedback faster;
  // bump back to 2h once the adapter is stable.
  pollIntervalSec: 3600,
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

      // Diagnostic: if emission=0 despite having response bodies, dump
      // the first event/market/odd sample so we can see the real shape
      // vs my assumptions.
      if (scraped.length === 0 && responseBodies.length > 0) {
        const firstBody = responseBodies[0]
        const firstEv = firstBody?.events?.[0]
        const firstMarket = firstBody?.markets?.[0]
        const firstOdd = firstBody?.odds?.[0]
        const sportIdCounts: Record<number, number> = {}
        for (const b of responseBodies) {
          for (const e of (b?.events ?? [])) {
            const sid = e.sportId ?? -1
            sportIdCounts[sid] = (sportIdCounts[sid] ?? 0) + 1
          }
        }
        log.info('sportzino shape diag', {
          firstEvent: firstEv ? JSON.stringify(firstEv).slice(0, 1200) : null,
          firstEventKeys: firstEv ? Object.keys(firstEv) : [],
          firstMarket: firstMarket ? JSON.stringify(firstMarket).slice(0, 600) : null,
          firstOdd: firstOdd ? JSON.stringify(firstOdd).slice(0, 400) : null,
          sportIdCounts,
          totalEvents: responseBodies.reduce((s, b) => s + (b?.events?.length ?? 0), 0),
          totalMarkets: responseBodies.reduce((s, b) => s + (b?.markets?.length ?? 0), 0),
          totalOdds: responseBodies.reduce((s, b) => s + (b?.odds?.length ?? 0), 0),
        })
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
