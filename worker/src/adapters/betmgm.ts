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
): { markets: GameMarket[]; debug: { catNames: string[]; statuses: string[]; total: number } } {
  const out: GameMarket[] = []
  const homeKey = homeName.split(' ').pop()?.toLowerCase() ?? ''
  const awayKey = awayName.split(' ').pop()?.toLowerCase() ?? ''

  const catNamesSeen = new Set<string>()
  const statusesSeen = new Set<string>()
  let totalRaw = 0

  // Entain CDS ships full-game ML/spread/total under `fixture.games`
  // (catId 43=ML, 44=spread, 45=total), with results carrying
  // sourceName.value '1'/'2'/'3' for home/away/draw and americanOdds
  // flat on the result. The old code tried `optionMarkets` instead,
  // which is empty on the league fixtures list (verified from the
  // diagnostic log — fixturesWithEmptyOptionMarkets matched the
  // fixture count exactly). Port the SI/SIA parser pattern.
  const games: any[] = (fixture as any)?.games ?? []
  const sideOf = (r: any): 'home' | 'away' | 'draw' | 'over' | 'under' | null => {
    const src = r?.sourceName?.value ?? ''
    if (src === '1') return 'home'
    if (src === '2') return 'away'
    if (src === '3') return 'draw'
    const lab = (r?.name?.value ?? '').toLowerCase()
    if (lab.startsWith('over')) return 'over'
    if (lab.startsWith('under')) return 'under'
    if (homeKey && lab.includes(homeKey)) return 'home'
    if (awayKey && lab.includes(awayKey)) return 'away'
    return null
  }

  for (const game of games) {
    totalRaw++
    const visibility = game?.visibility
    if (visibility) statusesSeen.add(String(visibility))
    if (visibility && visibility !== 'Visible') continue
    const catId: number = game?.categoryId ?? game?.templateCategory?.id ?? 0
    const name: string = (game?.name?.value ?? '').toLowerCase()
    if (name) catNamesSeen.add(name)
    const results: any[] = (game?.results ?? []).filter((r: any) => !r?.visibility || r?.visibility === 'Visible')
    if (results.length < 2) continue

    // Moneyline (catId 43)
    if (!out.some(g => g.marketType === 'moneyline')
        && (catId === 43 || /^moneyline$|^money line$|^match result$/.test(name))) {
      let home: number | null = null, away: number | null = null, draw: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds ?? r?.price?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        if (s === 'home') home = p
        else if (s === 'away') away = p
        else if (s === 'draw') draw = p
      }
      if (home != null && away != null) {
        out.push({
          marketType: 'moneyline',
          homePrice: home, awayPrice: away, drawPrice: draw,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      }
    }
    // Spread (catId 44)
    else if (!out.some(g => g.marketType === 'spread')
        && (catId === 44 || /^spread$|^handicap$|^run line$|^puck line$|^point spread$/.test(name))) {
      let home: number | null = null, away: number | null = null, line: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds ?? r?.price?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        const pts = Number(r?.points ?? r?.handicap)
        if (s === 'home') { home = p; if (isFinite(pts)) line = pts }
        else if (s === 'away') { away = p; if (line == null && isFinite(pts)) line = -pts }
      }
      if (home != null || away != null) {
        out.push({
          marketType: 'spread',
          homePrice: home, awayPrice: away, drawPrice: null,
          spreadValue: line, totalValue: null,
          overPrice: null, underPrice: null,
        })
      }
    }
    // Total (catId 45)
    else if (!out.some(g => g.marketType === 'total')
        && (catId === 45 || /^totals?$|^total (runs|goals|points|games)$/.test(name))) {
      let over: number | null = null, under: number | null = null, line: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds ?? r?.price?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        const pts = Number(r?.points ?? r?.handicap)
        if (s === 'over') { over = p; if (line == null && isFinite(pts)) line = pts }
        else if (s === 'under') { under = p; if (line == null && isFinite(pts)) line = pts }
      }
      if ((over != null || under != null) && line != null) {
        out.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null,
          spreadValue: null, totalValue: line,
          overPrice: over, underPrice: under,
        })
      }
    }
  }

  // Legacy path — keep optionMarkets parsing as a fallback for any
  // sport where Entain happens to ship game markets there instead of
  // games[]. Suspended/Closed/Hidden statuses are still filtered.
  for (const m of fixture.optionMarkets ?? []) {
    totalRaw++
    if (m.status) statusesSeen.add(m.status)
    // Old code skipped anything not status=Visible. BetMGM appears to
    // ship 'Active' / 'Open' interchangeably; broaden to "anything
    // except explicit Suspended / Closed / Hidden".
    const status = m.status ?? ''
    if (status && /^(suspended|closed|hidden|inactive|disabled)$/i.test(status)) continue
    // m.isMain === false filter dropped — Entain stopped flagging
    // game-line markets as isMain on the league-wide fixture list. We
    // don't need it: the catName match already restricts to game
    // lines and the per-market dedupe above keeps only the first.
    const catName = m.templateCategory?.name?.value ?? m.name?.value ?? ''
    if (catName) catNamesSeen.add(catName)
    const opts = m.options ?? []

    // Moneyline aliases: Entain has shipped "Match Result", "Result",
    // "Money Line" alongside "Moneyline" depending on sport.
    const isMoneyline = /^(moneyline|money\s*line|match\s*result|result|to\s*win|winner)$/i.test(catName)
    const isSpread = /^(spread|handicap|run\s*line|puck\s*line|point\s*spread|asian\s*handicap)$/i.test(catName)
    const isTotal = /^(totals?|total\s*(runs|goals|points|games))$/i.test(catName)

    if (isMoneyline && opts.length >= 2) {
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
    } else if (isSpread && opts.length >= 2) {
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
    } else if (isTotal && opts.length >= 2) {
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
  return {
    markets: out,
    debug: {
      catNames: [...catNamesSeen].slice(0, 30),
      statuses: [...statusesSeen],
      total: totalRaw,
    },
  }
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

        // Aggregate diagnostics so we can see exactly what BetMGM is
        // shipping when totalGameMkts comes back 0. The first fixture
        // with no markets after parse gets its full optionMarkets array
        // logged so the next iteration can see the real shape.
        const allCatNames = new Set<string>()
        const allStatuses = new Set<string>()
        let firstNoMarketSample: any = null
        let firstFixtureKeys: string[] | null = null

        for (const fixture of fixtures) {
          if (signal.aborted) break
          if (!firstFixtureKeys) firstFixtureKeys = Object.keys(fixture)
          const parts = fixture.participants ?? []
          const home = parts.find(p => p.properties?.type === 'HomeTeam') ?? parts[1]
          const away = parts.find(p => p.properties?.type === 'AwayTeam') ?? parts[0]
          const homeName = home?.name?.value ?? ''
          const awayName = away?.name?.value ?? ''
          if (!homeName || !awayName) continue

          const { markets: gameMarkets, debug } = parseFixtureMarkets(fixture, homeName, awayName)
          for (const c of debug.catNames) allCatNames.add(c)
          for (const s of debug.statuses) allStatuses.add(s)
          if (gameMarkets.length === 0 && !firstNoMarketSample && (fixture.optionMarkets?.length ?? 0) > 0) {
            firstNoMarketSample = JSON.stringify({
              id: fixture.id,
              keys: Object.keys(fixture).slice(0, 30),
              firstMarket: fixture.optionMarkets?.[0]
                ? JSON.stringify(fixture.optionMarkets[0]).slice(0, 1500)
                : null,
              marketCount: fixture.optionMarkets?.length ?? 0,
            }).slice(0, 2000)
          }
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

        log.info('betmgm parse diag', {
          comp: league.name,
          firstFixtureKeys,
          catNamesSeen: [...allCatNames],
          statusesSeen: [...allStatuses],
          fixturesWithEmptyOptionMarkets: fixtures.filter(f => (f.optionMarkets?.length ?? 0) === 0).length,
          firstNoMarketSample,
        })
      }

      log.info('betmgm scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
