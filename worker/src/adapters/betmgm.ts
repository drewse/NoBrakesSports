/**
 * BetMGM (Ontario) — real adapter (Entain CDS).
 *
 * The BetMGM SPA fires against www.on.betmgm.ca/cds-api/bettingoffer/*.
 * The key endpoint is /cds-api/bettingoffer/fixtures — inline events +
 * markets (moneyline/spread/total) + american odds. Public, no auth;
 * x-bwin-accessid in the query string gates access.
 *
 * Strategy: load the NBA league page once so the Entain CDN issues a
 * session cookie (GeoGuard / Akamai BMS sometimes gates it), then call
 * the fixture endpoints from inside the page context (inherits cookies
 * + TLS fingerprint).
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket } from '../lib/types.js'

const DOMAIN = 'www.on.betmgm.ca'
const ACCESS_ID = 'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy'
const COMMON_Q =
  `x-bwin-accessid=${ACCESS_ID}&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario`
const SEED_URL = `https://${DOMAIN}/en/sports/basketball-7/betting/usa-9/nba-6004`

interface League {
  sportId: number
  competitionId: number
  leagueSlug: string
  sport: string
  name: string
}

const LEAGUES: League[] = [
  { sportId: 7,  competitionId: 6004, leagueSlug: 'nba', sport: 'basketball', name: 'NBA' },
  { sportId: 23, competitionId: 75,   leagueSlug: 'mlb', sport: 'baseball',   name: 'MLB' },
  { sportId: 12, competitionId: 34,   leagueSlug: 'nhl', sport: 'ice_hockey', name: 'NHL' },
]

interface BMGOption {
  id?: number
  name?: { value?: string }
  sourceName?: { value?: string }
  price?: { americanOdds?: number; odds?: number }
  attr?: string
  totalsPrefix?: 'Over' | 'Under'
}

interface BMGMarket {
  name?: { value?: string }
  templateCategory?: { name?: { value?: string } }
  status?: string
  isMain?: boolean
  attr?: string
  options?: BMGOption[]
}

interface BMGFixture {
  id: string | number
  startDate?: string
  isOutright?: boolean
  isLive?: boolean
  competition?: { id?: number }
  participants?: Array<{
    name?: { value?: string }
    properties?: { type?: string }
  }>
  optionMarkets?: BMGMarket[]
}

function decimalToAmerican(d: number): number | null {
  if (!isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

function americanFromOption(o: BMGOption | undefined): number | null {
  if (!o?.price) return null
  if (typeof o.price.americanOdds === 'number') return o.price.americanOdds
  if (typeof o.price.odds === 'number') return decimalToAmerican(o.price.odds)
  return null
}

function parseFixtureMarkets(
  fixture: BMGFixture,
  homeName: string,
  awayName: string,
): GameMarket[] {
  const out: GameMarket[] = []
  const homeKey = homeName.split(' ').pop()?.toLowerCase() ?? ''
  const awayKey = awayName.split(' ').pop()?.toLowerCase() ?? ''

  for (const m of fixture.optionMarkets ?? []) {
    if (m.status !== 'Visible') continue
    if (m.isMain === false) continue
    const catName = m.templateCategory?.name?.value ?? m.name?.value ?? ''
    const opts = m.options ?? []

    if (catName === 'Moneyline' && opts.length >= 2) {
      if (out.some(g => g.marketType === 'moneyline')) continue
      const byName = (label: string) =>
        opts.find(o => (o.name?.value ?? '').toLowerCase().includes(label))
      const bySrc = (src: string) =>
        opts.find(o => (o.sourceName?.value ?? '') === src)
      const home = byName(homeKey) ?? bySrc('2')
      const away = byName(awayKey) ?? bySrc('1')
      const draw = opts.find(o => (o.name?.value ?? '').toLowerCase() === 'draw')
      out.push({
        marketType: 'moneyline',
        homePrice: americanFromOption(home),
        awayPrice: americanFromOption(away),
        drawPrice: americanFromOption(draw),
        spreadValue: null, totalValue: null,
        overPrice: null, underPrice: null,
      })
    } else if (
      (catName === 'Spread' || catName === 'Handicap'
        || catName === 'Run Line' || catName === 'Puck Line')
      && opts.length >= 2
    ) {
      if (out.some(g => g.marketType === 'spread')) continue
      const byName = (label: string) =>
        opts.find(o => (o.name?.value ?? '').toLowerCase().includes(label))
      const home = byName(homeKey) ?? opts[0]
      const away = home === opts[0] ? opts[1] : opts[0]
      const spread = home?.attr != null ? parseFloat(home.attr) : null
      out.push({
        marketType: 'spread',
        homePrice: americanFromOption(home),
        awayPrice: americanFromOption(away),
        drawPrice: null,
        spreadValue: spread == null || isNaN(spread) ? null : spread,
        totalValue: null, overPrice: null, underPrice: null,
      })
    } else if (
      (catName === 'Totals' || catName === 'Total Runs'
        || catName === 'Total Goals' || catName === 'Total Points')
      && opts.length >= 2
    ) {
      if (out.some(g => g.marketType === 'total')) continue
      const over = opts.find(o =>
        o.totalsPrefix === 'Over' || (o.name?.value ?? '').toLowerCase().startsWith('over'))
      const under = opts.find(o =>
        o.totalsPrefix === 'Under' || (o.name?.value ?? '').toLowerCase().startsWith('under'))
      const total = m.attr != null ? parseFloat(m.attr) : null
      if (total != null && !isNaN(total) && total > 0) {
        out.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: total,
          overPrice: americanFromOption(over),
          underPrice: americanFromOption(under),
        })
      }
    }
  }
  return out
}

export const betmgmAdapter: BookAdapter = {
  slug: 'betmgm_on',
  name: 'BetMGM (Ontario)',
  pollIntervalSec: 180,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      log.info('betmgm seeding session', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      } catch (e: any) {
        errors.push(`seed: ${e?.message ?? e}`)
        return { events: scraped, errors }
      }
      // Give Akamai/GeoGuard cookies time to settle.
      await page.waitForTimeout(5_000)

      const pageFetch = async (url: string): Promise<{ status: number; text: string }> => {
        return page.evaluate(async (u: string) => {
          try {
            const r = await fetch(u, {
              headers: { Accept: 'application/json, text/plain, */*' },
              credentials: 'include',
            })
            return { status: r.status, text: await r.text() }
          } catch (e: any) {
            return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
          }
        }, url)
      }

      for (const league of LEAGUES) {
        if (signal.aborted) break
        const listUrl =
          `https://${DOMAIN}/cds-api/bettingoffer/fixtures?${COMMON_Q}`
          + `&state=Latest&sportIds=${league.sportId}&take=200`
        const { status, text } = await pageFetch(listUrl)
        if (status !== 200) {
          log.warn('betmgm fixture list fetch non-200', {
            comp: league.name, status, sample: text.slice(0, 120),
          })
          errors.push(`${league.name} list HTTP ${status}`)
          continue
        }
        let listBody: any
        try { listBody = JSON.parse(text) } catch {
          errors.push(`${league.name} list non-JSON`)
          continue
        }
        const fixtures: BMGFixture[] = (listBody.fixtures ?? []).filter(
          (f: BMGFixture) =>
            f.competition?.id === league.competitionId
            && !f.isOutright && !f.isLive,
        )
        log.info('betmgm fixtures', { comp: league.name, count: fixtures.length })
        if (fixtures.length === 0) continue

        for (const fixture of fixtures) {
          if (signal.aborted) break
          const parts = fixture.participants ?? []
          const home = parts.find(p => p.properties?.type === 'HomeTeam') ?? parts[1]
          const away = parts.find(p => p.properties?.type === 'AwayTeam') ?? parts[0]
          const homeName = home?.name?.value ?? ''
          const awayName = away?.name?.value ?? ''
          if (!homeName || !awayName) continue

          const gameMarkets = parseFixtureMarkets(fixture, homeName, awayName)
          scraped.push({
            event: {
              externalId: String(fixture.id),
              homeTeam: homeName,
              awayTeam: awayName,
              startTime: fixture.startDate ?? '',
              leagueSlug: league.leagueSlug,
              sport: league.sport,
            },
            gameMarkets,
            props: [],
          })
        }
      }

      log.info('betmgm scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
