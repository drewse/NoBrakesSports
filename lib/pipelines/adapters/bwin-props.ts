/**
 * bwin Ontario adapter.
 *
 * Entain CDS API at www.on.bwin.ca/cds-api/
 * Same platform as bwin — shares fixture IDs and access ID.
 *
 * Two-step:
 *   1. /fixtures → list fixture IDs by sport, filter by competition
 *   2. /fixture-view → full markets + odds per fixture
 */

const BASE = 'https://www.on.bwin.ca/cds-api/bettingoffer'
const ACCESS_ID = 'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy'
const COMMON_PARAMS = `x-bwin-accessid=${ACCESS_ID}&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario`

const HEADERS: Record<string, string> = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Referer': 'https://www.on.bwin.ca/',
  'Origin': 'https://www.on.bwin.ca',
}

// bwin sport IDs → competition IDs we care about
export const BWIN_LEAGUES: { sportId: number; competitionId: number; leagueSlug: string; name: string }[] = [
  { sportId: 7,  competitionId: 6004,  leagueSlug: 'nba',  name: 'NBA' },
  { sportId: 23, competitionId: 9325,  leagueSlug: 'mlb',  name: 'MLB' },
  { sportId: 12, competitionId: 265,   leagueSlug: 'nhl',  name: 'NHL' },
  { sportId: 4,  competitionId: 46,    leagueSlug: 'epl',  name: 'EPL' },
]

export interface BWINEvent {
  fixtureId: string
  homeName: string
  awayName: string
  startTime: string
  leagueSlug: string
}

export interface BWINGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface BWINResult {
  event: BWINEvent
  gameMarkets: BWINGameMarket[]
}

async function fetchFixtureIds(sportId: number, competitionId: number): Promise<{ id: string; name: string; participants: any[]; startDate: string }[]> {
  const url = `${BASE}/fixtures?${COMMON_PARAMS}&state=Latest&sportIds=${sportId}&take=200`
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return []
    const data = await resp.json()
    return (data.fixtures ?? []).filter((f: any) =>
      f.competition?.id === competitionId && !f.isOutright && !f.isLive
    )
  } catch (e) {
    console.error(`bwin fixtures sportId=${sportId}:`, e)
    return []
  }
}

async function fetchFixtureMarkets(fixtureId: string): Promise<any> {
  const url = `${BASE}/fixture-view?${COMMON_PARAMS}&offerMapping=All&scoreboardMode=Full&fixtureIds=${fixtureId}&state=Latest&firstMarketGroupOnly=false`
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    return resp.json()
  } catch {
    return null
  }
}

function parseFixtureMarkets(data: any, leagueSlug: string): BWINResult | null {
  const fixture = data?.fixture
  if (!fixture) return null

  // Extract home/away team names from participants
  const participants = fixture.participants ?? []
  const homeTeam = participants.find((p: any) => p.properties?.type === 'HomeTeam')
  const awayTeam = participants.find((p: any) => p.properties?.type === 'AwayTeam')

  // Fallback: first two participants with no properties.type often are the teams
  const homeName = homeTeam?.name?.value ?? participants[1]?.name?.value ?? ''
  const awayName = awayTeam?.name?.value ?? participants[0]?.name?.value ?? ''

  if (!homeName || !awayName) return null

  const event: BWINEvent = {
    fixtureId: String(fixture.id),
    homeName,
    awayName,
    startTime: fixture.startDate ?? '',
    leagueSlug,
  }

  const gameMarkets: BWINGameMarket[] = []
  const optionMarkets = fixture.optionMarkets ?? []

  for (const market of optionMarkets) {
    if (market.status !== 'Visible') continue
    const catName = market.templateCategory?.name?.value ?? market.name?.value ?? ''
    const options = market.options ?? []

    if (catName === 'Moneyline' && market.isMain !== false) {
      // Find home/away by participantId or sourceName
      const homeOpt = options.find((o: any) => o.sourceName?.value === '2' || o.name?.value?.includes(homeName.split(' ').pop()))
      const awayOpt = options.find((o: any) => o.sourceName?.value === '1' || o.name?.value?.includes(awayName.split(' ').pop()))
      const drawOpt = options.find((o: any) => o.name?.value === 'Draw')
      gameMarkets.push({
        marketType: 'moneyline',
        homePrice: homeOpt?.price?.americanOdds ?? null,
        awayPrice: awayOpt?.price?.americanOdds ?? null,
        drawPrice: drawOpt?.price?.americanOdds ?? null,
        spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
      })
    } else if (catName === 'Spread' && market.isMain !== false) {
      // Only take the first (main) spread
      if (gameMarkets.some(gm => gm.marketType === 'spread')) continue
      const opt1 = options[0]
      const opt2 = options[1]
      if (!opt1 || !opt2) continue
      const spreadVal = Math.abs(parseFloat(opt1.attr ?? '0'))
      // Determine which is home/away
      const homeOpt = opt1.name?.value?.includes(homeName.split(' ').pop()) ? opt1 : opt2
      const awayOpt = homeOpt === opt1 ? opt2 : opt1
      gameMarkets.push({
        marketType: 'spread',
        homePrice: homeOpt?.price?.americanOdds ?? null,
        awayPrice: awayOpt?.price?.americanOdds ?? null,
        drawPrice: null,
        spreadValue: spreadVal,
        totalValue: null, overPrice: null, underPrice: null,
      })
    } else if (catName === 'Totals') {
      // Only take the first (main) total
      if (gameMarkets.some(gm => gm.marketType === 'total')) continue
      const overOpt = options.find((o: any) => o.totalsPrefix === 'Over')
      const underOpt = options.find((o: any) => o.totalsPrefix === 'Under')
      const totalVal = parseFloat(market.attr ?? '0')
      if (totalVal > 0) {
        gameMarkets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: totalVal,
          overPrice: overOpt?.price?.americanOdds ?? null,
          underPrice: underOpt?.price?.americanOdds ?? null,
        })
      }
    }
  }

  if (gameMarkets.length === 0) return null
  return { event, gameMarkets }
}

export async function scrapeBwin(signal?: AbortSignal): Promise<BWINResult[]> {
  const results: BWINResult[] = []

  // Fetch fixture lists for all leagues in parallel
  const leagueFixtures = await Promise.all(
    BWIN_LEAGUES.map(async (league) => {
      const fixtures = await fetchFixtureIds(league.sportId, league.competitionId)
      return { league, fixtures }
    })
  )

  // Fetch fixture details — batch with concurrency limit
  const MAX_CONCURRENT = 5
  for (const { league, fixtures } of leagueFixtures) {
    for (let i = 0; i < fixtures.length; i += MAX_CONCURRENT) {
      if (signal?.aborted) break
      const batch = fixtures.slice(i, i + MAX_CONCURRENT)
      const batchResults = await Promise.all(
        batch.map(async (fixture) => {
          const data = await fetchFixtureMarkets(String(fixture.id))
          if (!data) return null
          return parseFixtureMarkets(data, league.leagueSlug)
        })
      )
      for (const r of batchResults) {
        if (r) results.push(r)
      }
    }
  }

  return results
}
