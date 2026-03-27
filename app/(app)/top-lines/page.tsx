import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProGate } from '@/components/shared/pro-gate'
import { formatOdds, formatRelativeTime } from '@/lib/utils'

export const metadata = { title: 'Top Lines' }

export default async function TopLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; market?: string }>
}) {
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

  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: snapshots } = await supabase
    .from('market_snapshots')
    .select(
      `
      id, event_id, source_id, market_type, home_price, away_price,
      spread_value, total_value, snapshot_time,
      event:events(id, title, start_time, status, league:leagues(name, abbreviation)),
      source:market_sources(id, name, slug)
    `
    )
    .gt('snapshot_time', cutoff)
    .in('market_type', ['moneyline', 'spread', 'total'])
    .eq('events.status', 'scheduled')
    .order('snapshot_time', { ascending: false })
    .limit(isPro ? 3000 : 500)

  type Snap = typeof snapshots extends (infer T)[] | null ? T : never
  const grouped = new Map<string, Snap[]>()
  for (const snap of snapshots ?? []) {
    const ev = (snap as any).event
    if (!ev) continue
    const key = `${snap.event_id}::${snap.market_type}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(snap as any)
  }

  const topLines = Array.from(grouped.values())
    .map((snaps) => {
      const withHome = snaps.filter((s) => s.home_price != null)
      const withAway = snaps.filter((s) => s.away_price != null)
      if (withHome.length === 0 || withAway.length === 0) return null

      const bestHome = withHome.reduce((b, s) =>
        s.home_price! > b.home_price! ? s : b
      )
      const bestAway = withAway.reduce((b, s) =>
        s.away_price! > b.away_price! ? s : b
      )
      const avgHome =
        withHome.reduce((sum, s) => sum + s.home_price!, 0) / withHome.length
      const avgAway =
        withAway.reduce((sum, s) => sum + s.away_price!, 0) / withAway.length
      const event = (snaps[0] as any).event

      return {
        eventTitle: event?.title ?? '—',
        eventStart: event?.start_time ?? '',
        league: event?.league?.abbreviation ?? '—',
        leagueName: event?.league?.name ?? '—',
        marketType: snaps[0].market_type as string,
        bestHomePrice: bestHome.home_price!,
        bestHomeSource: (bestHome as any).source?.name ?? '—',
        bestAwayPrice: bestAway.away_price!,
        bestAwaySource: (bestAway as any).source?.name ?? '—',
        homeEdge: bestHome.home_price! - avgHome,
        awayEdge: bestAway.away_price! - avgAway,
        spreadValue: snaps[0].spread_value,
        totalValue: snaps[0].total_value,
        lastUpdated: snaps.reduce(
          (max, s) => (s.snapshot_time > max ? s.snapshot_time : max),
          snaps[0].snapshot_time
        ),
      }
    })
    .filter(Boolean) as NonNullable<
    ReturnType<typeof Array.prototype.map>[0]
  >[]

  topLines.sort((a, b) => {
    const order = ['moneyline', 'spread', 'total']
    return (
      order.indexOf((a as any).marketType) -
        order.indexOf((b as any).marketType) ||
      (a as any).eventTitle.localeCompare((b as any).eventTitle)
    )
  })

  const params = await searchParams
  const leagueFilter = params.league ?? 'all'
  const marketFilter = params.market ?? 'all'

  const leagues = Array.from(
    new Set(topLines.map((l: any) => l.league).filter(Boolean))
  ).sort()

  const filtered = topLines.filter((line: any) => {
    const leagueMatch =
      leagueFilter === 'all' || line.league === leagueFilter
    const marketMatch =
      marketFilter === 'all' || line.marketType === marketFilter
    return leagueMatch && marketMatch
  })

  const visibleLines = isPro ? filtered : filtered.slice(0, 5)
  const hiddenCount = filtered.length - visibleLines.length

  const uniqueEventCount = new Set(
    filtered.map((l: any) => l.eventTitle)
  ).size

  function EdgeDisplay({ value }: { value: number }) {
    const rounded = Math.round(value)
    if (rounded > 0) {
      return (
        <span className="font-mono text-xs text-white">+{rounded}</span>
      )
    }
    if (rounded < 0) {
      return (
        <span className="font-mono text-xs text-nb-500">{rounded}</span>
      )
    }
    return <span className="font-mono text-xs text-nb-400">0</span>
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Top Lines</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">
          Best available lines across {uniqueEventCount} events
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <form method="GET" className="flex items-center gap-3 flex-wrap">
          <input type="hidden" name="market" value={marketFilter} />
          <select
            name="league"
            defaultValue={leagueFilter}
            onChange={undefined}
            className="bg-nb-900 border border-nb-700 text-white text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-nb-500"
          >
            <option value="all">All Leagues</option>
            {leagues.map((lg: any) => (
              <option key={lg} value={lg}>
                {lg}
              </option>
            ))}
          </select>
          <noscript>
            <button
              type="submit"
              className="bg-nb-800 text-white text-xs px-3 py-1.5 rounded"
            >
              Filter
            </button>
          </noscript>
        </form>
        <form method="GET" className="flex items-center gap-2">
          <input type="hidden" name="league" value={leagueFilter} />
          {(['all', 'moneyline', 'spread', 'total'] as const).map((m) => (
            <button
              key={m}
              name="market"
              value={m}
              type="submit"
              className={`text-[10px] px-2.5 py-1 rounded border transition-colors capitalize ${
                marketFilter === m
                  ? 'bg-white text-nb-950 border-white font-semibold'
                  : 'bg-transparent text-nb-400 border-nb-700 hover:border-nb-500 hover:text-white'
              }`}
            >
              {m === 'all' ? 'All Types' : m}
            </button>
          ))}
        </form>
      </div>

      <ProGate isPro={isPro} featureName="Top Lines" blur={false}>
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
                      Type
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Best Home
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Best Away
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Home Edge
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Away Edge
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-8 text-center text-nb-400 text-xs"
                      >
                        No lines found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    visibleLines.map((line: any, i: number) => (
                      <tr
                        key={i}
                        className="border-b border-border/50 hover:bg-nb-800/20 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <span className="text-white text-xs font-medium">
                            {line.eventTitle}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-nb-400 text-xs">
                            {line.league}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant="muted"
                            className="text-[10px] capitalize"
                          >
                            {line.marketType}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-xs text-white">
                              {formatOdds(line.bestHomePrice)}
                            </span>
                            <span className="text-[10px] text-nb-400">
                              {line.bestHomeSource}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-mono text-xs text-white">
                              {formatOdds(line.bestAwayPrice)}
                            </span>
                            <span className="text-[10px] text-nb-400">
                              {line.bestAwaySource}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <EdgeDisplay value={line.homeEdge} />
                        </td>
                        <td className="px-4 py-2.5">
                          <EdgeDisplay value={line.awayEdge} />
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-nb-400 text-xs">
                            {formatRelativeTime(line.lastUpdated)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {!isPro && hiddenCount > 0 && (
              <div className="border-t border-nb-800 px-4 py-4 flex items-center justify-between">
                <p className="text-xs text-nb-400">
                  {hiddenCount} more lines available with Pro
                </p>
                <a
                  href="/upgrade"
                  className="text-xs font-semibold text-white bg-nb-800 hover:bg-nb-700 border border-nb-700 px-3 py-1.5 rounded transition-colors"
                >
                  Upgrade to Pro
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      </ProGate>
    </div>
  )
}
