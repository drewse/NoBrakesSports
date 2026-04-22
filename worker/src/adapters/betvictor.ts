/**
 * BetVictor (Ontario) — real adapter.
 *
 * Stack: BetVictor proprietary. Events are SSR'd into the HTML of league
 * meeting pages; live market prices ship via /bv_api/en-on/1/overview/markets
 * keyed by event_id. Two-step flow:
 *
 *   1. Navigate /en-on/sports/227/meetings/<meetingId>/all  (basketball/NBA)
 *      Parse HTML for `[data-event-id]` elements -> event_id, team names,
 *      start time.
 *   2. Batch event IDs -> call overview/markets with the three MBL market
 *      dimensions (handicap/over-under/money-line). Merge prices back onto
 *      events.
 *
 * Requires Canadian residential IP (IPRoyal Starlink). DO datacenter IP
 * gets back /geoblock + empty arrays.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedEvent } from '../lib/types.js'

interface League {
  leagueSlug: string
  sport: string
  meetingUrl: string
}

// Meeting IDs per league — DevTools-confirmed.
//   NBA:  sport 227,  meeting 367476010
//   MLB:  sport 226,  meeting 511759910
//   NHL:  sport 2100, meeting 369519410
const LEAGUES: League[] = [
  { leagueSlug: 'nba', sport: 'basketball', meetingUrl: 'https://www.betvictor.com/en-on/sports/227/meetings/367476010/all' },
  { leagueSlug: 'mlb', sport: 'baseball',   meetingUrl: 'https://www.betvictor.com/en-on/sports/226/meetings/511759910/all' },
  { leagueSlug: 'nhl', sport: 'ice_hockey', meetingUrl: 'https://www.betvictor.com/en-on/sports/2100/meetings/369519410/all' },
]

const MARKET_URL = 'https://www.betvictor.com/bv_api/en-on/1/overview/markets'

interface HtmlEvent {
  eventId: number
  startIso: string
  teams: string[]     // usually [home, away] or [away, home]; we figure out
}

interface MarketOutcome {
  id: number
  description?: string
  price?: { d?: number; f?: string; a?: number }
  americanPrice?: number
  decimalPrice?: number
  ok?: string        // outcome key: HOME, AWAY, OVER, UNDER
  oh?: number        // handicap / line value
}

interface Market {
  id: number
  eid: number
  mtid?: number
  mtdim?: string     // "handicap" | "over-under" | "money-line"
  pdim?: string      // "match"
  o?: number[]       // outcome ids
  outcomes?: MarketOutcome[]
}

function decimalToAmerican(d: number): number | null {
  if (!isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

function fractionalToAmerican(frac: string): number | null {
  const slash = frac.indexOf('/')
  if (slash === -1) return null
  const num = Number(frac.slice(0, slash))
  const den = Number(frac.slice(slash + 1))
  if (!isFinite(num) || !isFinite(den) || den === 0) return null
  const f = num / den
  return f >= 1 ? Math.round(f * 100) : Math.round(-(den / num) * 100)
}

function priceOf(o: MarketOutcome): number | null {
  if (typeof o?.americanPrice === 'number') return Math.round(o.americanPrice)
  if (typeof o?.decimalPrice === 'number') return decimalToAmerican(o.decimalPrice)
  if (typeof o?.price?.a === 'number') return Math.round(o.price.a)
  if (typeof o?.price?.d === 'number') return decimalToAmerican(o.price.d)
  if (typeof o?.price?.f === 'string') return fractionalToAmerican(o.price.f)
  return null
}

export const betvictorAdapter: BookAdapter = {
  slug: 'betvictor',
  name: 'BetVictor (Ontario)',
  pollIntervalSec: 300,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    if (process.env.BETVICTOR_ENABLED !== '1') {
      log.info('skipped — BETVICTOR_ENABLED=1 to run')
      return { events: [], errors: [] }
    }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      // Track CSRF + csrf cookie via passive capture (the SPA sets a
      // cookie named `csrf` on first load and sends it back as header
      // X-CSRF-Token on every /bv_api call).
      let csrfToken: string | null = null
      page.on('request', (req) => {
        const tok = req.headers()['x-csrf-token']
        if (tok && !csrfToken) csrfToken = tok
      })

      for (const L of LEAGUES) {
        if (signal.aborted) break

        log.info('betvictor seeding', { url: L.meetingUrl, league: L.leagueSlug })
        try {
          await page.goto(L.meetingUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        } catch (e: any) {
          log.warn('betvictor nav failed', { league: L.leagueSlug, message: e?.message ?? String(e) })
          errors.push(`${L.leagueSlug} nav: ${e?.message ?? e}`)
          continue
        }
        // Wait for event cards to hydrate — React ships the layout before
        // populating cards, and a flat 6s sleep wasn't enough.
        try {
          await page.waitForSelector('[data-event-id]', { timeout: 20_000 })
        } catch {
          // Log body shape so we see what landed instead (geoblock page?
          // redirect? splash?). Then move on to the next league.
          const title = await page.title().catch(() => '?')
          const url = page.url()
          log.warn('betvictor event cards not found', { league: L.leagueSlug, url, title })
        }
        await page.waitForTimeout(3_000)

        // 1) Scrape the meeting HTML for event cards.
        const scrape = await page.evaluate(() => {
          const out: Array<{ eventId: number; startIso: string; teams: string[] }> = []
          const cards = Array.from(document.querySelectorAll('[data-event-id]'))
          let firstCardHtml: string | null = null

          for (const card of cards) {
            const idStr = card.getAttribute('data-event-id')
            const dateStr = card.getAttribute('data-event-date')
            if (!idStr || !dateStr) continue
            const eventId = Number(idStr)
            if (!isFinite(eventId)) continue

            const teams: string[] = []
            // Broaden the selector sweep: try every class variant BetVictor
            // has shipped across desktop/mobile/meetings/inplay layouts,
            // then fall back to "any span/div inside each immediate child
            // div whose text looks like a team name".
            const nameSelectors = [
              '.inplay-coupon-name',
              '.coupon-team-name',
              '.event-team-name',
              '.participant-name',
              '.team-name',
              '.competition-team-name',
              '[class*="team-name"]',
              '[class*="participant"]',
            ]
            for (const sel of nameSelectors) {
              if (teams.length >= 2) break
              card.querySelectorAll(sel).forEach(el => {
                const name = (el.textContent ?? '').trim()
                if (name && name.length >= 2 && !teams.includes(name) && teams.length < 2) {
                  teams.push(name)
                }
              })
            }

            // Stash outerHTML of first card so we can see the real DOM if
            // none of the selectors landed.
            if (firstCardHtml == null) {
              firstCardHtml = card.outerHTML.slice(0, 2500)
            }

            if (teams.length >= 2) {
              out.push({ eventId, startIso: dateStr, teams: teams.slice(0, 2) })
            }
          }
          return { events: out, firstCardHtml, cardCount: cards.length }
        })

        const htmlEvents: HtmlEvent[] = scrape.events
        log.info('betvictor html events', {
          league: L.leagueSlug,
          count: htmlEvents.length,
          cardsInDom: scrape.cardCount,
        })
        // If we found cards but couldn't extract teams, dump the first
        // card's outerHTML so next cycle tells us which selector to use.
        if (htmlEvents.length === 0 && scrape.cardCount > 0 && scrape.firstCardHtml) {
          log.info('betvictor card html sample', {
            league: L.leagueSlug,
            sample: scrape.firstCardHtml,
          })
        }
        if (htmlEvents.length === 0) continue

        // 2) Batch a markets call for up to ~50 events per URL (the real
        // SPA batched 8 in its sample but the endpoint tolerates more).
        const BATCH = 40
        type EventMarkets = { moneyline: GameMarket | null; spread: GameMarket | null; total: GameMarket | null }
        const marketsByEvent = new Map<number, EventMarkets>()

        for (let i = 0; i < htmlEvents.length; i += BATCH) {
          if (signal.aborted) break
          const chunk = htmlEvents.slice(i, i + BATCH)
          const ids = chunk.map(e => e.eventId).join(',')

          // Build URL with the three market_type / period / outcome dims
          // exactly as the SPA's curl does.
          const qs = [
            `event_ids=${encodeURIComponent(ids)}`,
            `market_type_dimension%5B0%5D=handicap%40MBL`,
            `market_type_dimension%5B1%5D=over-under%40MBL`,
            `market_type_dimension%5B2%5D=money-line`,
            `period_dimension%5B0%5D=match`,
            `period_dimension%5B1%5D=match`,
            `period_dimension%5B2%5D=match`,
            `outcome_keys%5B0%5D=HOME%2CAWAY`,
            `outcome_keys%5B1%5D=OVER%2CUNDER`,
            `outcome_keys%5B2%5D=HOME%2CAWAY`,
            `ignore_outcome_keys=false`,
          ].join('&')
          const url = `${MARKET_URL}?${qs}`

          const { status, text } = await page.evaluate(async ({ u, tok }) => {
            try {
              const r = await fetch(u, {
                headers: {
                  Accept: 'application/json',
                  ...(tok ? { 'X-CSRF-Token': tok } : {}),
                },
                credentials: 'include',
              })
              return { status: r.status, text: await r.text() }
            } catch (e: any) {
              return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
            }
          }, { u: url, tok: csrfToken ?? '' })

          // Unconditional diagnostic: log every markets call so we see
          // whether CSRF fires, whether body is empty, etc.
          log.info('betvictor markets call', {
            league: L.leagueSlug,
            status,
            bodyLen: text.length,
            csrfCaptured: !!csrfToken,
            eventCount: chunk.length,
            sample: text.slice(0, 400),
          })

          if (status !== 200) {
            errors.push(`${L.leagueSlug} markets HTTP ${status}`)
            continue
          }

          let body: any
          try { body = JSON.parse(text) } catch {
            errors.push(`${L.leagueSlug} markets non-JSON`)
            continue
          }

          // Response shape (from DevTools curl):
          //   { markets: [{id, eid, mtdim, o:[outcomeIds]}],
          //     outcomes: [{id, ok:'HOME'|'AWAY'|'OVER'|'UNDER', oh?, price...}] }
          const markets: Market[] = Array.isArray(body?.markets) ? body.markets : []
          const outcomes: MarketOutcome[] = Array.isArray(body?.outcomes) ? body.outcomes : []
          const outcomeById = new Map<number, MarketOutcome>()
          for (const o of outcomes) outcomeById.set(o.id, o)

          for (const m of markets) {
            const em = marketsByEvent.get(m.eid) ?? { moneyline: null, spread: null, total: null }
            const outs = (m.o ?? []).map(id => outcomeById.get(id)).filter(Boolean) as MarketOutcome[]

            if (m.mtdim === 'money-line') {
              const home = outs.find(o => o.ok === 'HOME')
              const away = outs.find(o => o.ok === 'AWAY')
              em.moneyline = {
                marketType: 'moneyline',
                homePrice: home ? priceOf(home) : null,
                awayPrice: away ? priceOf(away) : null,
                drawPrice: null,
                spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
              }
            } else if (m.mtdim === 'handicap') {
              const home = outs.find(o => o.ok === 'HOME')
              const away = outs.find(o => o.ok === 'AWAY')
              const line = home?.oh ?? (away?.oh != null ? -(away.oh) : null)
              em.spread = {
                marketType: 'spread',
                homePrice: home ? priceOf(home) : null,
                awayPrice: away ? priceOf(away) : null,
                drawPrice: null, spreadValue: line ?? null,
                totalValue: null, overPrice: null, underPrice: null,
              }
            } else if (m.mtdim === 'over-under') {
              const over = outs.find(o => o.ok === 'OVER')
              const under = outs.find(o => o.ok === 'UNDER')
              const line = over?.oh ?? under?.oh ?? null
              em.total = {
                marketType: 'total',
                homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
                totalValue: line,
                overPrice: over ? priceOf(over) : null,
                underPrice: under ? priceOf(under) : null,
              }
            }
            marketsByEvent.set(m.eid, em)
          }
        }

        // 3) Emit normalized events. BetVictor HTML lists teams in visual
        // order (usually away first on top row for US sports). Check the
        // markets response: HOME is defined by the book, so we don't need
        // to guess from team order — we just use [0], [1] as home/away
        // tuple and rely on the HOME/AWAY tags on markets.
        //
        // To keep our canonical key stable, we pass both teams into the
        // event and let downstream normalize on name. Assume index 0 =
        // team listed first in card (top line), which on BetVictor NBA
        // UI is the AWAY team.
        let loggedSample = false
        for (const he of htmlEvents) {
          const em = marketsByEvent.get(he.eventId)
          if (!em) continue
          const gameMarkets: GameMarket[] = []
          if (em.moneyline) gameMarkets.push(em.moneyline)
          if (em.spread) gameMarkets.push(em.spread)
          if (em.total) gameMarkets.push(em.total)
          if (gameMarkets.length === 0) continue

          // Convention: BetVictor coupons list AWAY on top, HOME on bottom.
          const away = he.teams[0]
          const home = he.teams[1] ?? he.teams[0]

          if (!loggedSample) {
            loggedSample = true
            log.info('betvictor sample event', {
              id: he.eventId, home, away, start: he.startIso,
              markets: gameMarkets.map(m => m.marketType),
            })
          }

          const event: NormalizedEvent = {
            externalId: String(he.eventId),
            homeTeam: home,
            awayTeam: away,
            startTime: he.startIso,
            leagueSlug: L.leagueSlug,
            sport: L.sport,
          }
          scraped.push({ event, gameMarkets, props: [] })
        }
      }

      log.info('betvictor scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true, ignoreHTTPSErrors: true })
  },
}
