import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProGate } from '@/components/shared/pro-gate'
import {
  formatOdds,
  formatRelativeTime,
  americanToImpliedProb,
  getMarketShape,
  calcCombinedProb,
  type MarketShape,
} from '@/lib/utils'
import { isUpcomingEvent } from '@/lib/queries'

export const metadata = { title: 'Arbitrage' }

// League abbreviation -> slug mapping used for shape detection
const ABBREV_TO_SLUG: Record<string, string> = {
  EPL: 'epl',
  MLS: 'mls',
  'NCAA Soccer': 'ncaasoccer',
}

export default async function ArbitragePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()
  const isPro =
    profile?.subscription_tier === 'pro' &&
    profile?.subscription_status === 'active'

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: snapshots } = await supabase
    .from('market_snapshots')
    .select(
      `
      event_id, source_id, market_type, home_price, away_price, draw_price, snapshot_time,
      event:events(id, title, start_time, status, league:leagues(name, abbreviation, slug)),
      source:market_sources(id, name, slug)
    `
    )
    .gt('snapshot_time', cutoff)
    .eq('market_type', 'moneyline')
    .order('snapshot_time', { ascending: false })
    .limit(2000)

  // Filter out Polymarket — crowd prices are illiquid and unreliable for
  // guaranteed arbitrage (can't reliably bet both sides at quoted prices)
  const filteredSnapshots = (snapshots ?? []).filter(
    s => (s as any).source?.slug !== 'polymarket'
  )

  // Group snapshots by event_id — skip events without embedded event data
  const byEvent = new Map<string, (typeof snapshots extends (infer T)[] | null ? T : never)[]>()
  for (const snap of filteredSnapshots) {
    const ev = (snap as any).event
    if (!ev) continue
    if (!byEvent.has(snap.event_id)) byEvent.set(snap.event_id, [])
    byEvent.get(snap.event_id)!.push(snap as any)
  }

  const arbs: {
    eventTitle: string
    league: string
    shape: MarketShape
    bestHomePrice: number
    bestHomeSource: string
    bestDrawPrice: number | null
    bestDrawSource: string | null
    bestAwayPrice: number
    bestAwaySource: string
    homeProb: number
    drawProb: number | null
    awayProb: number
    combinedProb: number
    profitPct: number
    lastUpdated: string
  }[] = []

  for (const snaps of byEvent.values()) {
    const event = (snaps[0] as any).event
    // Pre-game only: skip events that have already started
    if (!isUpcomingEvent(event?.start_time)) continue
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string =
      event?.league?.slug ?? ABBREV_TO_SLUG[leagueAbbrev] ?? ''

    const shape = getMarketShape(leagueSlug || null, null, 'moneyline')

    const withHome = snaps.filter((s: any) => s.home_price != null)
    const withAway = snaps.filter((s: any) => s.away_price != null)
    const withDraw = snaps.filter((s: any) => s.draw_price != null)

    // Need at least 2 books for home and away to have an arb
    if (withHome.length < 2 || withAway.length < 2) continue

    // For 3-way markets, require draw data from at least one book
    if (shape === '3way' && withDraw.length === 0) continue

    const bestHome = withHome.reduce((b: any, s: any) =>
      s.home_price! > b.home_price! ? s : b
    )
    const bestAway = withAway.reduce((b: any, s: any) =>
      s.away_price! > b.away_price! ? s : b
    )
    const bestDrawSnap =
      withDraw.length > 0
        ? withDraw.reduce((b: any, s: any) =>
            s.draw_price! > b.draw_price! ? s : b
          )
        : null

    // For 3-way, we need a draw price to compute a valid arb
    if (shape === '3way' && bestDrawSnap == null) continue

    const homeProb = americanToImpliedProb(bestHome.home_price!)
    const awayProb = americanToImpliedProb(bestAway.away_price!)
    const drawProb =
      bestDrawSnap != null
        ? americanToImpliedProb(bestDrawSnap.draw_price!)
        : null

    const combinedProb = calcCombinedProb(shape, homeProb, drawProb, awayProb)

    if (combinedProb < 1.0) {
      const profitPct = (1 / combinedProb - 1) * 100
      arbs.push({
        eventTitle: event?.title ?? '—',
        league: leagueAbbrev || '—',
        shape,
        bestHomePrice: bestHome.home_price!,
        bestHomeSource: (bestHome as any).source?.name ?? '—',
        bestDrawPrice: bestDrawSnap?.draw_price ?? null,
        bestDrawSource: bestDrawSnap != null ? ((bestDrawSnap as any).source?.name ?? '—') : null,
        bestAwayPrice: bestAway.away_price!,
        bestAwaySource: (bestAway as any).source?.name ?? '—',
        homeProb,
        drawProb,
        awayProb,
        combinedProb,
        profitPct,
        lastUpdated: snaps.reduce(
          (max: string, s: any) =>
            s.snapshot_time > max ? s.snapshot_time : max,
          snaps[0].snapshot_time
        ),
      })
    }
  }

  arbs.sort((a, b) => b.profitPct - a.profitPct)

  const uniqueBooks = new Set([
    ...arbs.map((a) => a.bestHomeSource),
    ...arbs.map((a) => a.bestAwaySource),
  ]).size

  function ProfitDisplay({ value }: { value: number }) {
    if (value > 1) {
      return (
        <span className="font-mono text-xs font-bold text-white">
          {value.toFixed(2)}%
        </span>
      )
    }
    if (value >= 0.5) {
      return (
        <span className="font-mono text-xs text-nb-300">
          {value.toFixed(2)}%
        </span>
      )
    }
    return (
      <span className="font-mono text-xs text-nb-400">
        {value.toFixed(2)}%
      </span>
    )
  }

  function CombinedProbDisplay({ value }: { value: number }) {
    const pct = value * 100
    if (pct < 98) {
      return (
        <span className="font-mono text-xs text-green-400">
          {pct.toFixed(1)}%
        </span>
      )
    }
    if (pct < 99.5) {
      return (
        <span className="font-mono text-xs text-yellow-400">
          {pct.toFixed(1)}%
        </span>
      )
    }
    return (
      <span className="font-mono text-xs text-red-400">
        {pct.toFixed(1)}%
      </span>
    )
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Arbitrage</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">
          {arbs.length} opportunities detected across {uniqueBooks} books
        </p>
      </div>

      <ProGate isPro={isPro} featureName="Arbitrage" blur={false}>
        {arbs.length === 0 ? (
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="px-6 py-12 flex flex-col items-center justify-center text-center gap-3">
              <p className="text-white text-sm font-medium">
                No arbitrage opportunities detected
              </p>
              <p className="text-nb-400 text-xs max-w-sm">
                No arbitrage opportunities detected in the last 2 hours.
                Opportunities are rare and short-lived.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-nb-800">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Event
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        League
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Shape
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Best Home
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Draw
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Best Away
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Combined Prob
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Profit %
                      </th>
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                        Updated
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {arbs.map((arb, i) => (
                      <tr
                        key={i}
                        className={`border-b border-border/50 hover:bg-nb-800/20 transition-colors ${
                          arb.profitPct > 2 ? 'border-l-2 border-l-white' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <span className="text-white text-xs font-medium">
                            {arb.eventTitle}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-nb-400 text-xs">
                            {arb.league}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              arb.shape === '3way'
                                ? 'bg-nb-800 text-nb-300'
                                : 'bg-nb-800 text-nb-500'
                            }`}
                          >
                            {arb.shape === '3way' ? '3W' : '2W'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-xs text-white">
                              {formatOdds(arb.bestHomePrice)}
                            </span>
                            <span className="text-[10px] text-nb-400">
                              {arb.bestHomeSource}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          {arb.shape === '3way' && arb.bestDrawPrice != null ? (
                            <div className="flex flex-col gap-0.5">
                              <span className="font-mono text-xs text-white">
                                {formatOdds(arb.bestDrawPrice)}
                              </span>
                              <span className="text-[10px] text-nb-400">
                                {arb.bestDrawSource}
                              </span>
                            </div>
                          ) : (
                            <span className="font-mono text-xs text-nb-600">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-xs text-white">
                              {formatOdds(arb.bestAwayPrice)}
                            </span>
                            <span className="text-[10px] text-nb-400">
                              {arb.bestAwaySource}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <CombinedProbDisplay value={arb.combinedProb} />
                        </td>
                        <td className="px-4 py-2.5">
                          <ProfitDisplay value={arb.profitPct} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-nb-400 text-xs">
                            {formatRelativeTime(arb.lastUpdated)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </ProGate>
    </div>
  )
}
