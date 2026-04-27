/**
 * Bally Bet (Ontario) — real adapter (Kambi white-label).
 *
 * Confirmed via DevTools curl:
 *   Base:    https://eu1.offering-api.kambicdn.com/offering/v2018/bcscaon
 *   Client:  bcscaon   (Bally Canada Sports CA-ON)
 *   ListView: /listView/{sport}/{league}/all/all/competitions.json
 *   Origin:  https://play.ballybet.ca  (referer)
 *   Market:  CA-ON, lang: en_CA (en_US returns abbreviated team names like
 *            "DET Pistons" which don't match our canonical event rows and
 *            create orphan events in the Markets view).
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

      // Kambi offering-api is public CDN — skip the page seed and use
      // the context's APIRequestContext. Avoids "Execution context
      // destroyed" errors when the origin host redirects mid-fetch.
      const pageFetch = async (url: string): Promise<{ status: number; text: string }> => {
        try {
          const r = await page.context().request.get(url, {
            headers: {
              Accept: '*/*',
              Origin: ORIGIN,
              Referer: `${ORIGIN}/`,
            },
          })
          return { status: r.status(), text: await r.text() }
        } catch (e: any) {
          return { status: -1, text: `request threw: ${e?.message ?? String(e)}` }
        }
      }

      // 1) Pull event lists per league in parallel.
      //    Kambi's listView wraps each row as { event: {...}, betOffers: [...] }
      //    — event metadata only here; betoffers fetched in step 2.
      await Promise.all(LEAGUES.map(async (league) => {
        const url =
          `${KAMBI_HOST}/offering/v2018/${CLIENT}/listView/`
          + `${league.sportPath}/${league.leaguePath}/all/all/matches.json`
          + `?channel_id=1&client_id=200&lang=en_CA&market=CA-ON&useCombined=true&useCombinedLive=true`
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
        const url = `${BETOFFER_BASE}/${chunk}.json?lang=en_CA&market=CA-ON&includeParticipants=true`
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
      // Period / team-specific criteria we must NEVER pick as the main
      // game-line offer. Kambi's Match / Handicap / Over-Under types
      // each contain dozens of variants per event — quarter/half MLs,
      // first-to-N-points props, team-specific totals — and the main
      // full-game line is just one of them. Picking blindly from the
      // category produces wrong odds (e.g. a 1Q ML with -110/-110 in
      // place of the real game ML at -425/+320).
      const isPartialOrTeamScoped = (cLabel: string): boolean => {
        const l = cLabel.toLowerCase()
        if (/\b(quarter|1h|2h|half|halftime|first\s+to|result\s+at\s+end|draw\s+no\s+bet|by\s+[a-z])/i.test(l)) return true
        return false
      }

      for (const [eventId, meta] of eventsById) {
        if (!meta.homeName || !meta.awayName) continue
        const offers = offersByEvent.get(eventId) ?? []
        const gameMarkets: GameMarket[] = []

        // Pick the most-balanced offer (smallest |homeProb + awayProb - 1|
        // + |homeProb - awayProb|). Kambi often leaves `main: true` unset
        // on every candidate (notably for "Including Overtime" playoff
        // fixtures), so flagged-first / arr[0] both pick wrong lines.
        // Used for Spread + Total only — NOT for ML, since the real game
        // ML is by design lopsided when there's a heavy favorite.
        const pickBalanced = (arr: KBetOffer[]): KBetOffer | undefined => {
          if (arr.length === 0) return undefined
          const flagged = arr.find(o => o.main)
          if (flagged) return flagged
          let best = arr[0]
          let bestScore = Infinity
          for (const o of arr) {
            const outs = o.outcomes ?? []
            const a = kambiToAmerican(outs[0])
            const b = kambiToAmerican(outs[1])
            if (a == null || b == null) continue
            const ap = a > 0 ? 100 / (a + 100) : -a / (-a + 100)
            const bp = b > 0 ? 100 / (b + 100) : -b / (-b + 100)
            const score = Math.abs(ap + bp - 1) + Math.abs(ap - bp)
            if (score < bestScore) { best = o; bestScore = score }
          }
          return best
        }

        // Pick the first offer whose criterion is a full-game line — used
        // for ML where there's only one true game ML per event.
        const pickFirstFullGame = (arr: KBetOffer[]): KBetOffer | undefined => {
          const flagged = arr.find(o => o.main)
          if (flagged) return flagged
          return arr[0]
        }

        // Moneyline — restrict to canonical full-game ML criteria. Reject
        // period and team-scoped variants explicitly.
        const mlCandidates = offers.filter(o => {
          if (o.betOfferType?.englishName !== 'Match') return false
          const cLabel = (o.criterion?.englishLabel ?? '').toLowerCase()
          if (isPartialOrTeamScoped(cLabel)) return false
          // Accept canonical full-game variants:
          //   "Full Time" (regular), "Moneyline" / "Money Line",
          //   "Moneyline - Including Overtime" (NBA playoff Game 5 shape),
          //   "Match Winner" (soccer)
          return cLabel === 'full time'
              || cLabel === 'match winner'
              || cLabel.startsWith('moneyline')
              || cLabel.startsWith('money line')
        })
        const ml = pickFirstFullGame(mlCandidates)
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

        // Spread — restrict to full-game point-spread criteria, then
        // pick the most-balanced (true main line, not an alt).
        const spreadCandidates = offers.filter(o => {
          if (o.betOfferType?.englishName !== 'Handicap') return false
          const cLabel = (o.criterion?.englishLabel ?? '').toLowerCase()
          if (isPartialOrTeamScoped(cLabel)) return false
          return cLabel === 'handicap'
              || cLabel.startsWith('point spread')
              || cLabel.startsWith('run line')
              || cLabel.startsWith('puck line')
        })
        const spread = pickBalanced(spreadCandidates)
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

        // Total — restrict to full-game totals criteria; reject team
        // totals + period variants.
        const totalCandidates = offers.filter(o => {
          if (o.betOfferType?.englishName !== 'Over/Under') return false
          const cLabel = (o.criterion?.englishLabel ?? '').toLowerCase()
          if (isPartialOrTeamScoped(cLabel)) return false
          return cLabel === 'total'
              || cLabel.startsWith('total points')
              || cLabel.startsWith('total runs')
              || cLabel.startsWith('total goals')
        })
        const total = pickBalanced(totalCandidates)
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

        if (gameMarkets.length === 0) {
          if (offers.length > 0) {
            log.warn('ballybet event has offers but 0 markets', {
              eventId, name: meta.name,
              offerTypes: [...new Set(offers.map(o => o.betOfferType?.englishName ?? '?'))],
            })
          }
          continue
        }
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
    }, { useProxy: false })   // Kambi offering-api is public CDN — no proxy needed.
  },
}
