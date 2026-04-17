// Temporary: check what bwin returns for steals markets
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const ACCESS_ID = 'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy'

export async function GET(req: NextRequest) {
  // No auth — temporary debug endpoint, will be deleted

  const results: any = {}

  // Try all 3 Entain domains
  const domains = [
    { name: 'bwin', domain: 'sports.bwin.ca' },
    { name: 'betmgm', domain: 'www.on.betmgm.ca' },
    { name: 'partypoker', domain: 'sports.partypoker.ca' },
  ]

  for (const { name, domain } of domains) {
    try {
      const COMMON = `x-bwin-accessid=${ACCESS_ID}&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario`
      const HEADERS = {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://${domain}/`,
        'Origin': `https://${domain}`,
      }

      // Get NBA fixtures
      const fixResp = await fetch(
        `https://${domain}/cds-api/bettingoffer/fixtures?${COMMON}&state=Latest&sportIds=7&take=20`,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      )
      if (!fixResp.ok) { results[name] = { error: `fixtures ${fixResp.status}` }; continue }
      const fixData = await fixResp.json()
      const games = (fixData.fixtures ?? []).filter((f: any) => f.competition?.id === 6004 && !f.isOutright && !f.isLive)
      results[name] = { games: games.length }

      if (games.length === 0) continue

      // Fetch first game's fixture-view
      const fid = games[0].id
      results[name].fixtureId = fid
      results[name].fixtureName = games[0].name?.value

      const viewResp = await fetch(
        `https://${domain}/cds-api/bettingoffer/fixture-view?${COMMON}&offerMapping=All&fixtureIds=${fid}&state=Latest&firstMarketGroupOnly=false`,
        { headers: HEADERS, signal: AbortSignal.timeout(10000) }
      )
      if (!viewResp.ok) { results[name].fixtureView = `HTTP ${viewResp.status}`; continue }
      const viewData = await viewResp.json()
      const markets = viewData.fixture?.optionMarkets ?? []
      results[name].totalMarkets = markets.length

      // Find steals
      const stealsMarkets = markets.filter((m: any) => {
        const cat = (m.templateCategory?.name?.value ?? '').toLowerCase()
        const mname = (m.name?.value ?? '').toLowerCase()
        return cat.includes('steal') || mname.includes('steal')
      })
      results[name].stealsMarkets = stealsMarkets.length

      // Show first few steals details
      results[name].stealsSamples = stealsMarkets.slice(0, 3).map((m: any) => ({
        catName: m.templateCategory?.name?.value,
        marketName: m.name?.value,
        attr: m.attr,
        options: (m.options ?? []).map((o: any) => ({
          name: o.name?.value,
          totalsPrefix: o.totalsPrefix,
          odds: o.price?.americanOdds,
        })),
      }))

      // Also show all unique category names for 2-option markets
      const cats = new Set<string>()
      markets.filter((m: any) => m.options?.length === 2 && m.attr != null).forEach((m: any) => {
        cats.add(m.templateCategory?.name?.value ?? m.name?.value ?? '?')
      })
      results[name].allPropCategories = [...cats].sort()

    } catch (e: any) {
      results[name] = { error: e.message }
    }
  }

  return NextResponse.json(results)
}
