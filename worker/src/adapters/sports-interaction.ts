/**
 * Sports Interaction (Ontario) — Railway port of the existing Vercel
 * pipeline adapter. Vercel kept hitting FILE_ERROR_NO_SPACE launching
 * Chromium in serverless; Railway has a real disk so Playwright is
 * stable.
 *
 * Same Entain CDS surface the Vercel adapter speaks:
 *   Base:   https://www.on.sportsinteraction.com/cds-api
 *   Auth:   x-bwin-accessid query param (public key)
 *   Origin: https://www.on.sportsinteraction.com
 *
 * Flow:
 *   1. Visit a lightweight cds-api endpoint via real Chromium so
 *      Cloudflare hands us cookies.
 *   2. Page-side fetch of /bettingoffer/fixtures (paginated) — list of
 *      upcoming fixtures with team / start / competition.
 *   3. Pick a marketGroupId from one fixture-view probe (group IDs are
 *      UUIDs, vary per session).
 *   4. Page-side fetch of /bettingoffer/fixture-view in chunks; parse
 *      moneyline (catId 43), spread (44), total (45).
 *
 * Scope of this port: NBA / MLB / NHL game lines only. Soccer leagues
 * + props can be ported later — the Vercel file has the league map and
 * market extractors and they're functionally identical.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type {
  ScrapeResult,
  ScrapedEvent,
  GameMarket,
  MarketType,
  NormalizedEvent,
} from '../lib/types.js'

const BASE   = 'https://www.on.sportsinteraction.com'
const API    = `${BASE}/cds-api`
const ACCESS = 'NDg1MTQwNTMtMWJjNC00NTgxLWE0MzktY2JjYTMzZjdkZTVm'

const COMMON_PARAMS = new URLSearchParams({
  'x-bwin-accessid': ACCESS,
  lang:              'en-ca',
  country:           'CA',
  userCountry:       'CA',
  subdivision:       'CA-Ontario',
  supportVirtual:    'true',
}).toString()

const SEED_URL = `${API}/bettingoffer/counts?${COMMON_PARAMS}&tagTypes=Sport&state=Latest`

// Sport id → canonical sport / leagueSlug. SIA uses these numeric IDs in
// fixture.sport.id; the competition name string maps to our league slug.
const TARGET_SPORT_IDS = new Set([7, 12, 23]) // basketball, hockey, baseball

interface SiFixture {
  id: number
  homeTeam: string
  awayTeam: string
  startDate: string
  leagueSlug: string
  sport: string
}

function toLeagueSlug(competitionName: string): string {
  const n = (competitionName ?? '').toLowerCase().trim()
  if (n === 'nba' || n === 'nba basketball') return 'nba'
  if (n === 'nhl' || n === 'nhl hockey')     return 'nhl'
  if (n === 'mlb' || n === 'mlb baseball')   return 'mlb'
  return ''
}

function toSport(leagueSlug: string): string {
  if (leagueSlug === 'nba') return 'basketball'
  if (leagueSlug === 'nhl') return 'ice_hockey'
  if (leagueSlug === 'mlb') return 'baseball'
  return ''
}

/** Run a fetch from inside the Chromium context so Cloudflare cookies +
 *  fingerprint are attached automatically. Returns parsed JSON or null. */
async function pageFetchJson(
  page: import('playwright').Page,
  url: string,
): Promise<any | null> {
  try {
    return await page.evaluate(async ({ url, base }) => {
      const r = await fetch(url, {
        method: 'GET',
        headers: { Origin: base, Referer: `${base}/`, Accept: 'application/json' },
        credentials: 'include',
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    }, { url, base: BASE })
  } catch {
    return null
  }
}

function parseFixtureList(data: any): SiFixture[] {
  const out: SiFixture[] = []
  const fixtures: any[] = data?.fixtures ?? (data?.fixture ? [data.fixture] : [])

  for (const f of fixtures) {
    const id = Number(f?.id ?? f?.sourceId)
    if (!id) continue
    if (!TARGET_SPORT_IDS.has(f?.sport?.id)) continue
    const participants: any[] = f?.participants ?? []
    if (participants.length !== 2) continue

    let homeTeam = '', awayTeam = ''
    for (const p of participants) {
      const name: string = p?.name?.value ?? p?.name ?? ''
      const pos: string  = (p?.homeAway ?? p?.position ?? '').toLowerCase()
      if (pos === 'home' || pos === '1')      homeTeam = name
      else if (pos === 'away' || pos === '2') awayTeam = name
    }
    if (!homeTeam || !awayTeam) continue

    const startDate: string = f?.startDate ?? f?.startTime ?? ''
    if (!startDate) continue

    const competitionName: string =
      f?.competition?.name?.value ??
      f?.league?.name?.value ??
      (f?.tags ?? []).find((t: any) => t?.type === 'Competition')?.name?.value ?? ''
    const leagueSlug = toLeagueSlug(competitionName)
    if (!leagueSlug) continue

    out.push({ id, homeTeam, awayTeam, startDate, leagueSlug, sport: toSport(leagueSlug) })
  }
  return out
}

interface ExtractedMarkets {
  ml?: GameMarket
  spread?: GameMarket
  total?: GameMarket
}

function extractGameMarkets(fixture: any): ExtractedMarkets {
  const out: ExtractedMarkets = {}
  const games: any[] = fixture?.games ?? []

  for (const game of games) {
    if (game?.visibility !== 'Visible') continue
    const catId: number = game?.categoryId ?? game?.templateCategory?.id ?? 0
    const name: string  = (game?.name?.value ?? '').toLowerCase()
    const results: any[] = (game?.results ?? []).filter((r: any) => r?.visibility === 'Visible')
    if (results.length < 2) continue

    const sideOf = (r: any): 'home' | 'away' | 'draw' | 'over' | 'under' | null => {
      const src = r?.sourceName?.value ?? ''
      if (src === '1') return 'home'
      if (src === '2') return 'away'
      if (src === '3') return 'draw'
      const lab = (r?.name?.value ?? '').toLowerCase()
      if (lab.startsWith('over'))  return 'over'
      if (lab.startsWith('under')) return 'under'
      return null
    }

    // Moneyline
    if (!out.ml && (catId === 43 || (game?.isMain && name === 'moneyline'))) {
      let home: number | null = null, away: number | null = null, draw: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        if (s === 'home') home = p
        else if (s === 'away') away = p
        else if (s === 'draw') draw = p
      }
      if (home != null && away != null) {
        out.ml = {
          marketType: 'moneyline' as MarketType,
          homePrice: home, awayPrice: away, drawPrice: draw,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        }
      }
    }

    // Spread
    if (!out.spread && (catId === 44 || name === 'spread')) {
      let home: number | null = null, away: number | null = null, line: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds)
        if (!isFinite(p)) continue
        const hcap = parseFloat(r?.attr ?? '')
        if (!isFinite(hcap)) continue
        if (line === null) line = Math.abs(hcap)
        const s = sideOf(r)
        if (s === 'home') home = p
        else if (s === 'away') away = p
      }
      if (home != null && away != null && line != null) {
        out.spread = {
          marketType: 'spread' as MarketType,
          homePrice: home, awayPrice: away, drawPrice: null,
          spreadValue: line, totalValue: null, overPrice: null, underPrice: null,
        }
      }
    }

    // Total (over/under)
    if (!out.total && (catId === 45 || name.startsWith('total') || name.startsWith('over/under'))) {
      const over  = results.find((r: any) => sideOf(r) === 'over')
      const under = results.find((r: any) => sideOf(r) === 'under')
      if (!over || !under) continue
      const overP  = Number(over.americanOdds)
      const underP = Number(under.americanOdds)
      if (!isFinite(overP) || !isFinite(underP)) continue
      const fromName = parseFloat(String(over.name?.value ?? '').replace(/[^0-9.]/g, ''))
      const fromAttr = parseFloat(over.attr ?? '')
      const line = isFinite(fromAttr) ? fromAttr : isFinite(fromName) ? fromName : null
      if (line === null) continue
      out.total = {
        marketType: 'total' as MarketType,
        homePrice: null, awayPrice: null, drawPrice: null,
        spreadValue: null, totalValue: line, overPrice: overP, underPrice: underP,
      }
    }
  }

  return out
}

export const sportsInteractionAdapter: BookAdapter = {
  slug: 'sports_interaction',
  name: 'Sports Interaction (Ontario)',
  pollIntervalSec: 600, // 10 min — same cadence as the old Vercel pipeline
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapedEvent[] = []

      // 1. Seed cookies via a lightweight page nav.
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('sia seed nav failed', { message: e?.message ?? String(e) })
        errors.push(`seed nav: ${e?.message ?? e}`)
        return { events: [], errors }
      }
      // Tiny pause so any CF challenge JS has a chance to settle.
      await page.waitForTimeout(2_000)

      // 2. Pull fixture list across a few pages — the API ignores the
      //    sport tag filter and returns everything in one big stream.
      const fixtures: SiFixture[] = []
      for (const skip of [0, 200, 400, 600, 800]) {
        if (signal.aborted) break
        const url =
          `${API}/bettingoffer/fixtures?${COMMON_PARAMS}` +
          `&state=Latest&skip=${skip}&take=200`
        const data = await pageFetchJson(page, url)
        if (!data) { errors.push(`fixtures skip=${skip}`); continue }
        fixtures.push(...parseFixtureList(data))
      }
      log.info('sia fixtures', { count: fixtures.length, sample: fixtures[0] ?? null })
      if (fixtures.length === 0) {
        return { events: [], errors }
      }

      const fixtureIds = fixtures.map(f => f.id)

      // 3. Probe one fixture-view to discover the marketGroupId UUID.
      let marketGroupId: string | null = null
      try {
        const probe = await pageFetchJson(
          page,
          `${API}/bettingoffer/fixture-view?${COMMON_PARAMS}` +
            `&fixtureIds=${fixtureIds[0]}&state=Latest` +
            `&offerMapping=Filtered&scoreboardMode=None` +
            `&useRegionalisedConfiguration=true&includeRelatedFixtures=false` +
            `&statisticsModes=None&firstMarketGroupOnly=true`,
        )
        const groupIds: string[] = probe?.availableMarketGroupIds ?? []
        marketGroupId = groupIds[0] ?? null
      } catch (e: any) {
        errors.push(`probe: ${e?.message ?? e}`)
      }

      // 4. Fetch fixture-view in chunks of 10 (the page handles concurrency
      //    fine since each call goes through the same Chromium context).
      const byFixture = new Map(fixtures.map(f => [f.id, f]))
      const CHUNK = 10
      for (let i = 0; i < fixtureIds.length; i += CHUNK) {
        if (signal.aborted) break
        const chunk = fixtureIds.slice(i, i + CHUNK)
        await Promise.allSettled(
          chunk.map(async (id) => {
            const url =
              `${API}/bettingoffer/fixture-view?${COMMON_PARAMS}` +
              `&fixtureIds=${id}&state=Latest` +
              `&offerMapping=All&scoreboardMode=None` +
              `&useRegionalisedConfiguration=true&includeRelatedFixtures=false` +
              `&statisticsModes=None&firstMarketGroupOnly=false` +
              (marketGroupId ? `&marketGroupId=${marketGroupId}` : '')
            const data = await pageFetchJson(page, url)
            if (!data) { errors.push(`fixture-view ${id}`); return }
            const list: any[] = data?.fixtures ?? (data?.fixture ? [data.fixture] : [])
            for (const fx of list) {
              const meta = byFixture.get(Number(fx?.id))
              if (!meta) continue
              const ms = extractGameMarkets(fx)
              const gm: GameMarket[] = []
              if (ms.ml)     gm.push(ms.ml)
              if (ms.spread) gm.push(ms.spread)
              if (ms.total)  gm.push(ms.total)
              if (gm.length === 0) continue
              const event: NormalizedEvent = {
                externalId: String(meta.id),
                homeTeam:   meta.homeTeam,
                awayTeam:   meta.awayTeam,
                startTime:  meta.startDate,
                leagueSlug: meta.leagueSlug,
                sport:      meta.sport,
              }
              scraped.push({ event, gameMarkets: gm, props: [] })
            }
          }),
        )
      }

      log.info('sia scrape summary', {
        events: scraped.length,
        markets: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
        errors: errors.length,
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
