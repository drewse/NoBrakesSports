// ─────────────────────────────────────────────────────────────────────────────
// Sports Interaction Ontario adapter
//
// Platform: Entain/GVC CDS (Content Distribution System)
// Endpoint discovery: 2026-04-02
//   Base:   https://www.on.sportsinteraction.com/cds-api
//   Auth:   x-bwin-accessid query param (permanent public key, no rotation observed)
//   Origin: https://www.on.sportsinteraction.com
//
// Uses Playwright (real Chromium) — site is behind Cloudflare.
//
// Data flow:
//   1. Visit site once to get Cloudflare cookies
//   2. GET /bettingoffer/fixtures?tagIds={sportId}&tagTypes=Sport
//        → list of upcoming fixture IDs with metadata (teams, start time, competition)
//   3. GET /bettingoffer/fixture-view?fixtureIds={id1,id2,...}
//        → full market data for each fixture (batched 25 at a time)
//
// Prices: `americanOdds` is provided directly in the response — no conversion.
//
// Market identification (by templateCategory.id):
//   43  = Moneyline (isMain: true)
//   44  = Spread    (options have attr: "+X.X" / "-X.X", player1/player2 fields)
//   game total: options have totalsPrefix ("Over"/"Under") AND name.value has no ":" (≠ team total)
//
// Sport IDs (from /bettingoffer/counts?tagTypes=Sport):
//   4=Soccer  7=Basketball  11=Football  12=Hockey  23=Baseball
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SourceAdapter,
  FetchEventsResult,
  FetchMarketsResult,
  HealthCheckResult,
  CanonicalEvent,
  CanonicalMarket,
  CanonicalOutcome,
} from '../types'
import { normalizeEvent, americanToImplied, detectMarketShape } from '../normalize'
import { withBrowser } from '../browser-fetch'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE    = 'https://www.on.sportsinteraction.com'
const API     = `${BASE}/cds-api`
const ACCESS  = 'NDg1MTQwNTMtMWJjNC00NTgxLWE0MzktY2JjYTMzZjdkZTVm'
const SEED_URL = `${BASE}/sports/basketball/nba`

const COMMON_PARAMS = new URLSearchParams({
  'x-bwin-accessid': ACCESS,
  'lang':            'en-ca',
  'country':         'CA',
  'userCountry':     'CA',
  'subdivision':     'CA-Ontario',
  'supportVirtual':  'true',
}).toString()

const API_HEADERS = {
  Origin:  BASE,
  Referer: `${BASE}/`,
}

// ── League slug mapping ───────────────────────────────────────────────────────

function toLeagueSlug(competitionName: string): string {
  const n = (competitionName ?? '').toLowerCase().trim()

  const exact: Record<string, string> = {
    // Basketball
    'nba':                         'nba',
    'nba g league':                'nba_gleague',
    'ncaa':                        'ncaab',
    'ncaab':                       'ncaab',
    'ncaa basketball':             'ncaab',
    'euroleague':                  'euroleague',
    'nbl':                         'nbl',
    // Hockey
    'nhl':                         'nhl',
    'ahl':                         'ahl',
    // Football
    'nfl':                         'nfl',
    'ncaa football':               'ncaaf',
    // Baseball
    'mlb':                         'mlb',
    // Soccer
    'english premier league':      'epl',
    'premier league':              'epl',
    'mls':                         'mls',
    'major league soccer':         'mls',
    'la liga':                     'laliga',
    'bundesliga':                  'bundesliga',
    'serie a':                     'seria_a',
    'ligue 1':                     'ligue_one',
    'eredivisie':                  'eredivisie',
    'primeira liga':               'liga_portugal',
    'scottish premiership':        'spl',
    'champions league':            'ucl',
    'uefa champions league':       'ucl',
    'europa league':               'uel',
    'uefa europa league':          'uel',
    'conference league':           'uecl',
    'fa cup':                      'fa_cup',
    'championship':                'efl_champ',
    'efl championship':            'efl_champ',
    'league one':                  'efl_league1',
    'league two':                  'efl_league2',
    'a-league men':                'australia_aleague',
    'a-league':                    'australia_aleague',
    'k league 1':                  'k_league1',
    'k league 2':                  'k_league2',
    'j. league':                   'j_league',
    'j league':                    'j_league',
    'liga mx':                     'liga_mx',
  }

  return exact[n] ?? n.replace(/\s+/g, '_')
}

// ── Fixture listing ───────────────────────────────────────────────────────────

interface SiFixture {
  id: number
  name: string           // "Team A vs Team B" — from fixture.name.value or parsed
  homeTeam: string
  awayTeam: string
  startDate: string      // ISO 8601
  leagueSlug: string
}

/**
 * Parse the fixture list response from /bettingoffer/fixtures.
 * The Entain CDS API returns: { "fixtures": [...] } or { "fixture": {...} }.
 */
function parseFixtureList(data: any): SiFixture[] {
  const raw: any[] = data.fixtures ?? (data.fixture ? [data.fixture] : [])
  const out: SiFixture[] = []

  for (const f of raw) {
    const id: number = f.id
    if (!id) continue

    // Start date
    const startDate: string = f.startDate ?? f.startTime ?? ''
    if (!startDate) continue

    // Team names — from participants array or name field
    let homeTeam = ''
    let awayTeam = ''

    for (const p of f.participants ?? []) {
      const pName: string = p.name?.value ?? p.name ?? ''
      const pos: string = (p.homeAway ?? p.position ?? '').toLowerCase()
      if (pos === 'home' || pos === '1') homeTeam = pName
      else if (pos === 'away' || pos === '2') awayTeam = pName
    }

    // Fallback: parse "Home vs Away" from fixture name
    if (!homeTeam || !awayTeam) {
      const title: string = f.name?.value ?? f.name ?? ''
      const vsParts = title.split(' vs ')
      if (vsParts.length === 2) {
        homeTeam = homeTeam || vsParts[0].trim()
        awayTeam = awayTeam || vsParts[1].trim()
      }
    }

    if (!homeTeam || !awayTeam) continue

    // Competition / league slug
    const competitionName: string =
      f.competition?.name?.value ??
      f.league?.name?.value ??
      (f.tags ?? []).find((t: any) => t.type === 'Competition')?.name?.value ??
      ''
    const leagueSlug = toLeagueSlug(competitionName)

    out.push({ id, name: `${homeTeam} vs ${awayTeam}`, homeTeam, awayTeam, startDate, leagueSlug })
  }

  return out
}

// ── Market extraction ─────────────────────────────────────────────────────────

function buildOutcome(
  name: string,
  americanOdds: number,
  side: CanonicalOutcome['side']
): CanonicalOutcome {
  return { side, label: name, price: americanOdds, impliedProb: americanToImplied(americanOdds) }
}

function extractMarketsFromFixtureView(
  fixtureData: any,
  fixtureMap: Map<number, SiFixture>
): { events: CanonicalEvent[]; markets: CanonicalMarket[] } {
  const raws: any[] = fixtureData.fixtures ?? (fixtureData.fixture ? [fixtureData.fixture] : [])
  const events: CanonicalEvent[] = []
  const markets: CanonicalMarket[] = []

  for (const fixture of raws) {
    const fixtureId: number = fixture.id
    if (!fixtureId) continue

    // Prefer fixtureMap (populated during two-step flow); fall back to fixture object fields
    const meta = fixtureMap.get(fixtureId)

    // Extract start time
    const startDate: string = meta?.startDate ?? fixture.startDate ?? fixture.startTime ?? ''
    if (!startDate) continue

    // Extract team names — try participants array, then fixture name, then spread market
    let homeTeam = meta?.homeTeam ?? ''
    let awayTeam = meta?.awayTeam ?? ''
    if (!homeTeam || !awayTeam) {
      for (const p of fixture.participants ?? []) {
        const pName: string = p.name?.value ?? p.name ?? ''
        const pos: string = (p.homeAway ?? p.position ?? '').toLowerCase()
        if (pos === 'home' || pos === '1') homeTeam = pName
        else if (pos === 'away' || pos === '2') awayTeam = pName
      }
    }
    if (!homeTeam || !awayTeam) {
      const title: string = fixture.name?.value ?? fixture.name ?? ''
      const parts = title.split(' vs ')
      if (parts.length === 2) { homeTeam = homeTeam || parts[0].trim(); awayTeam = awayTeam || parts[1].trim() }
    }
    // Last resort: grab from spread market's player1/player2
    if (!homeTeam || !awayTeam) {
      const spreadMarket = (fixture.optionMarkets ?? []).find((om: any) => om.templateCategory?.id === 44)
      if (spreadMarket) { homeTeam = homeTeam || spreadMarket.player1?.value || ''; awayTeam = awayTeam || spreadMarket.player2?.value || '' }
    }
    if (!homeTeam || !awayTeam) continue

    // Extract league slug
    const competitionName: string =
      meta?.leagueSlug ? '' :  // skip lookup if already resolved
      fixture.competition?.name?.value ??
      fixture.league?.name?.value ??
      (fixture.tags ?? []).find((t: any) => t.type === 'Competition')?.name?.value ?? ''
    const leagueSlug = meta?.leagueSlug || toLeagueSlug(competitionName)

    events.push(normalizeEvent({
      externalId: String(fixtureId),
      homeTeam,
      awayTeam,
      startTime:  startDate,
      leagueSlug,
      sourceSlug: 'sports_interaction',
    }))

    const optionMarkets: any[] = fixture.optionMarkets ?? []

    for (const om of optionMarkets) {
      if (om.status !== 'Visible') continue

      const marketName: string = om.name?.value ?? ''
      const catId: number = om.templateCategory?.id ?? 0
      const options: any[] = (om.options ?? []).filter((o: any) => o.status === 'Visible')
      if (options.length < 2) continue

      // ── Moneyline ──────────────────────────────────────────────────────────
      if (catId === 43 || (om.isMain && marketName.toLowerCase() === 'moneyline')) {
        const outcomes: CanonicalOutcome[] = []
        for (const opt of options) {
          const price: number = opt.price?.americanOdds
          if (price == null) continue
          // Fallback: compare full name to home/away team
          const optName: string = opt.name?.value ?? ''
          const resolvedSide: CanonicalOutcome['side'] =
            homeTeam.includes(optName) || optName.includes(homeTeam.split(' ').pop()!)
              ? 'home' : 'away'
          outcomes.push(buildOutcome(optName, price, resolvedSide))
        }
        if (outcomes.length >= 2) {
          markets.push({
            eventId: String(fixtureId),
            marketType: 'moneyline',
            shape: detectMarketShape(leagueSlug, 'moneyline'),
            outcomes,
            lineValue: null,
            sourceSlug: 'sports_interaction',
            capturedAt: new Date().toISOString(),
          })
        }

      // ── Spread ────────────────────────────────────────────────────────────
      } else if (catId === 44 || marketName.toLowerCase() === 'spread') {
        const outcomes: CanonicalOutcome[] = []
        let lineValue: number | null = null

        // player1 = home, player2 = away (Entain convention)
        const homePlayerName: string = om.player1?.value ?? ''
        const awayPlayerName: string = om.player2?.value ?? ''

        for (const opt of options) {
          const price: number = opt.price?.americanOdds
          if (price == null) continue
          const attr: string = opt.attr ?? ''
          const hcap = parseFloat(attr)
          if (isNaN(hcap)) continue
          if (lineValue === null) lineValue = Math.abs(hcap)

          const optName: string = opt.name?.value ?? ''
          // Determine side: compare participantId or name to player1/player2
          const pid: number = opt.participantId
          let side: CanonicalOutcome['side'] = 'home'
          if (homePlayerName && awayPlayerName) {
            side = optName.includes(homePlayerName) || pid === om.player1Id ? 'home' : 'away'
          } else {
            side = hcap > 0 ? 'away' : 'home'  // positive handicap = underdog = away
          }
          outcomes.push(buildOutcome(optName, price, side))
        }

        if (outcomes.length >= 2 && lineValue !== null) {
          markets.push({
            eventId: String(fixtureId),
            marketType: 'spread',
            shape: '2way',
            outcomes,
            lineValue,
            sourceSlug: 'sports_interaction',
            capturedAt: new Date().toISOString(),
          })
        }

      // ── Game Total (Over/Under) ────────────────────────────────────────────
      // Identify by: options have totalsPrefix AND market name has no ":" (≠ team total)
      } else if (
        options.some((o: any) => o.totalsPrefix) &&
        !marketName.includes(':')
      ) {
        const outcomes: CanonicalOutcome[] = []
        let lineValue: number | null = null

        // Try attr on the market itself first, then parse from option names
        const attrLine = parseFloat(om.attr ?? '')
        if (!isNaN(attrLine)) lineValue = attrLine

        for (const opt of options) {
          const price: number = opt.price?.americanOdds
          if (price == null) continue
          const prefix: string = (opt.totalsPrefix ?? '').toLowerCase()
          if (prefix !== 'over' && prefix !== 'under') continue

          const optName: string = opt.name?.value ?? ''
          // Parse line from option name if not yet known (e.g., "Over 231.5")
          if (lineValue === null) {
            const match = optName.match(/[\d.]+/)
            if (match) lineValue = parseFloat(match[0])
          }

          const side: CanonicalOutcome['side'] = prefix === 'over' ? 'over' : 'under'
          outcomes.push(buildOutcome(optName, price, side))
        }

        if (outcomes.length >= 2 && lineValue !== null) {
          markets.push({
            eventId: String(fixtureId),
            marketType: 'total',
            shape: '2way',
            outcomes,
            lineValue,
            sourceSlug: 'sports_interaction',
            capturedAt: new Date().toISOString(),
          })
        }
      }
    }
  }

  return { events, markets }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const sportsInteractionAdapter: SourceAdapter = {
  slug: 'sports_interaction',
  ingestionMethod: 'playwright + cds-api',

  async fetchEvents(): Promise<FetchEventsResult> {
    const start = Date.now()

    // Sport IDs confirmed from /bettingoffer/counts?tagTypes=Sport
    const SPORTS = [
      { id: 7,  name: 'Basketball' },
      { id: 12, name: 'Hockey' },
      { id: 11, name: 'Football' },
      { id: 23, name: 'Baseball' },
      { id: 4,  name: 'Soccer' },
    ]

    // Only pull fixtures for leagues we explicitly support — avoids fetching
    // hundreds of obscure competitions and keeps batch count manageable.
    const TARGET_LEAGUES = new Set([
      'nba', 'nba_gleague', 'ncaab', 'nhl', 'ahl', 'nfl', 'ncaaf', 'mlb',
      'epl', 'mls', 'laliga', 'bundesliga', 'seria_a', 'ligue_one', 'ucl',
      'uel', 'uecl', 'eredivisie', 'liga_portugal', 'spl', 'efl_champ',
      'fa_cup', 'liga_mx', 'j_league', 'k_league1', 'k_league2',
      'australia_aleague', 'euroleague', 'nbl',
    ])

    return withBrowser(async ({ visit, fetchJson }) => {
      await visit(SEED_URL)

      const allEvents: CanonicalEvent[] = []
      const allMarkets: CanonicalMarket[] = []
      const rawPayloads: unknown[] = []
      const errors: string[] = []
      const fixtureMap = new Map<number, SiFixture>()

      // Step 1: get fixture list per sport, filter to target leagues
      const allFixtureIds: number[] = []
      await Promise.allSettled(
        SPORTS.map(async (sport) => {
          try {
            const url =
              `${API}/bettingoffer/fixtures?${COMMON_PARAMS}` +
              `&tagIds=${sport.id}&tagTypes=Sport&state=Latest&skip=0&take=200`
            const data = await fetchJson(url, API_HEADERS)
            const fixtures: any[] = data?.fixtures ?? (data?.fixture ? [data.fixture] : [])
            // Log raw competition names from first few fixtures to debug slug mapping
            const sampleComps = fixtures.slice(0, 5).map((f: any) =>
              f.competition?.name?.value ?? f.league?.name?.value ??
              (f.tags ?? []).find((t: any) => t.type === 'Competition')?.name?.value ??
              (f.tags ?? []).find((t: any) => t.type === 'Sport')?.name?.value ??
              `[keys:${Object.keys(f).join(',')}]`
            )
            console.log(`[sports_interaction] ${sport.name} sample comps:`, JSON.stringify(sampleComps))
            // Dump first fixture raw to diagnose why parseFixtureList returns 0
            if (fixtures.length > 0) console.log(`[sports_interaction] ${sport.name} first fixture raw:`, JSON.stringify(fixtures[0]).slice(0, 600))
            const parsed = parseFixtureList({ fixtures })
            const filtered = parsed.filter(f => TARGET_LEAGUES.has(f.leagueSlug))
            const allSlugs = [...new Set(parsed.map(f => f.leagueSlug))].slice(0, 20)
            console.log(`[sports_interaction] ${sport.name}: ${fixtures.length} raw → ${parsed.length} parsed → ${filtered.length} target-league. slugs: ${allSlugs.join(',')}`)
            for (const f of filtered) {
              fixtureMap.set(f.id, f)
              allFixtureIds.push(f.id)
            }
          } catch (e: any) {
            errors.push(`${sport.name} fixtures: ${e.message}`)
          }
        })
      )

      console.log(`[sports_interaction] filtered fixture IDs: ${allFixtureIds.length}`)
      if (allFixtureIds.length === 0) {
        return { raw: rawPayloads, events: [], markets: [], errors } as any
      }

      // Step 2: batch-fetch market data — run 5 batches concurrently
      const BATCH = 25
      const CONCURRENCY = 5
      const batches: number[][] = []
      for (let i = 0; i < allFixtureIds.length; i += BATCH) {
        batches.push(allFixtureIds.slice(i, i + BATCH))
      }

      for (let i = 0; i < batches.length; i += CONCURRENCY) {
        const chunk = batches.slice(i, i + CONCURRENCY)
        await Promise.allSettled(
          chunk.map(async (ids, j) => {
            try {
              const url =
                `${API}/bettingoffer/fixture-view?${COMMON_PARAMS}` +
                `&fixtureIds=${ids.join(',')}&state=Latest` +
                `&offerMapping=Filtered&scoreboardMode=None` +
                `&useRegionalisedConfiguration=true&includeRelatedFixtures=false` +
                `&statisticsModes=None&firstMarketGroupOnly=true`
              const data = await fetchJson(url, API_HEADERS)
              if (i === 0 && j === 0) {
                // Log first batch response shape to diagnose parsing issues
                const raws = data?.fixtures ?? (data?.fixture ? [data.fixture] : [])
                console.log(`[sports_interaction] fixture-view sample: keys=${Object.keys(data ?? {}).join(',')}, fixtures=${raws.length}, first fixture keys=${Object.keys(raws[0] ?? {}).join(',')}`)
              }
              rawPayloads.push(data)
              const { events, markets } = extractMarketsFromFixtureView(data, fixtureMap)
              allEvents.push(...events)
              allMarkets.push(...markets)
            } catch (e: any) {
              errors.push(`fixture-view batch ${i + j}: ${e.message}`)
            }
          })
        )
      }

      console.log(
        `[sports_interaction] fetchEvents: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`
      )
      if (errors.length) console.error('[sports_interaction] errors:', errors)

      return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
    })
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    return withBrowser(async ({ visit, fetchJson }) => {
      await visit(SEED_URL)

      try {
        const url =
          `${API}/bettingoffer/fixture-view?${COMMON_PARAMS}` +
          `&offerMapping=All&scoreboardMode=None` +
          `&fixtureIds=${eventId}&state=Latest` +
          `&useRegionalisedConfiguration=true&includeRelatedFixtures=false` +
          `&statisticsModes=None&firstMarketGroupOnly=false`
        const data = await fetchJson(url, API_HEADERS)

        // Lightweight dummy fixtureMap — team names come from market data
        const fixtureMap = new Map<number, SiFixture>()
        const id = Number(eventId)
        const fixtures: any[] = data.fixtures ?? (data.fixture ? [data.fixture] : [])
        for (const f of fixtures) {
          const parts = (f.name?.value ?? '').split(' vs ')
          fixtureMap.set(f.id, {
            id: f.id,
            name: f.name?.value ?? '',
            homeTeam: parts[0]?.trim() ?? '',
            awayTeam: parts[1]?.trim() ?? '',
            startDate: f.startDate ?? '',
            leagueSlug: '',
          })
        }

        const { markets } = extractMarketsFromFixtureView(data, fixtureMap)
        return { raw: data, markets }
      } catch (e: any) {
        throw new Error(`sports_interaction fetchMarkets(${eventId}): ${e.message}`)
      }
    })
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await withBrowser(async ({ fetchJson }) => {
        // counts endpoint is lightweight and reliably returns sport fixture counts
        const url = `${API}/bettingoffer/counts?${COMMON_PARAMS}&tagTypes=Sport&state=Latest`
        const data = await fetchJson(url, API_HEADERS)
        if (!data || typeof data !== 'object') throw new Error('Unexpected response shape')
      })
      const latencyMs = Date.now() - start
      return { healthy: true, latencyMs, message: `ok (${latencyMs}ms)` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
