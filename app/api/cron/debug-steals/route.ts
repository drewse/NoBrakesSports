// Temporary: check what Entain returns for steals markets
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const ACCESS_ID = 'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy'

export async function GET(req: NextRequest) {
  const results: any = {}

  const domains = [
    { name: 'betmgm', domain: 'www.on.betmgm.ca' },
    { name: 'bwin', domain: 'sports.bwin.ca' },
    { name: 'partypoker', domain: 'sports.partypoker.ca' },
  ]

  for (const { name, domain } of domains) {
    try {
      const COMMON = `x-bwin-accessid=${ACCESS_ID}&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario`
      const HEADERS: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://${domain}/`,
        'Origin': `https://${domain}`,
      }

      // Get NBA fixtures - filter to real games only
      const fixResp = await fetch(
        `https://${domain}/cds-api/bettingoffer/fixtures?${COMMON}&state=Latest&sportIds=7&take=50`,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      )
      if (!fixResp.ok) { results[name] = { error: `fixtures HTTP ${fixResp.status}` }; continue }
      const fixData = await fixResp.json()
      const allGames = (fixData.fixtures ?? []).filter((f: any) =>
        f.competition?.id === 6004 && !f.isOutright && !f.isLive
      )
      // Skip futures/drafts — pick games with participants
      const games = allGames.filter((f: any) => (f.participants ?? []).length >= 2)
      results[name] = {
        totalFixtures: allGames.length,
        realGames: games.length,
        gameNames: games.slice(0, 3).map((g: any) => g.name?.value),
      }

      if (games.length === 0) continue

      // Fetch first real game
      const fid = games[0].id
      results[name].fixtureId = fid

      const viewResp = await fetch(
        `https://${domain}/cds-api/bettingoffer/fixture-view?${COMMON}&offerMapping=All&fixtureIds=${fid}&state=Latest&firstMarketGroupOnly=false`,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      )
      if (!viewResp.ok) { results[name].fixtureView = `HTTP ${viewResp.status}`; continue }
      const viewData = await viewResp.json()
      const markets = viewData.fixture?.optionMarkets ?? []
      results[name].totalMarkets = markets.length

      // Find steals by checking ALL markets
      const stealsMarkets = markets.filter((m: any) => {
        const cat = (m.templateCategory?.name?.value ?? '').toLowerCase()
        const mname = (m.name?.value ?? '').toLowerCase()
        return (cat.includes('steal') || mname.includes('steal')) && m.options?.length === 2
      })
      results[name].stealsMarkets = stealsMarkets.length

      results[name].stealsSamples = stealsMarkets.slice(0, 3).map((m: any) => ({
        catName: m.templateCategory?.name?.value,
        marketName: m.name?.value,
        attr: m.attr,
        status: m.status,
        options: (m.options ?? []).map((o: any) => ({
          name: o.name?.value,
          totalsPrefix: o.totalsPrefix,
          sourceName: o.sourceName?.value,
          odds: o.price?.americanOdds,
        })),
      }))

      // Show all unique categories for 2-option attr markets
      const cats = new Set<string>()
      markets.filter((m: any) => m.options?.length === 2 && m.attr != null && m.status === 'Visible').forEach((m: any) => {
        cats.add(m.templateCategory?.name?.value ?? '?')
      })
      results[name].allCategories = [...cats].sort()

    } catch (e: any) {
      results[name] = { error: e.message }
    }
  }

  return NextResponse.json(results)
}
