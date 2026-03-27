import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProGate } from '@/components/shared/pro-gate'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatOdds, formatRelativeTime } from '@/lib/utils'

export const metadata = { title: 'History' }

export default async function HistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('subscription_tier, subscription_status').eq('id', user.id).single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const { data: snapshots } = await supabase
    .from('market_snapshots')
    .select(`*, event:events(id, title, start_time, league:leagues(abbreviation)), source:market_sources(name)`)
    .order('snapshot_time', { ascending: false })
    .limit(200)

  const grouped = (snapshots ?? []).reduce((acc: Record<string, any[]>, snap) => {
    const date = snap.snapshot_time.split('T')[0]
    if (!acc[date]) acc[date] = []
    acc[date].push(snap)
    return acc
  }, {})

  const uniqueEvents = new Set(snapshots?.map((s) => s.event_id)).size

  return (
    <div className="p-6 space-y-6 max-w-[1100px]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">History</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">Historical market data snapshots</p>
      </div>

      <ProGate isPro={isPro} featureName="Historical Analytics" blur={false}>
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Snapshots', value: snapshots?.length ?? 0 },
              { label: 'Days Tracked', value: Object.keys(grouped).length },
              { label: 'Events', value: uniqueEvents },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="p-4">
                  <p className="text-[10px] text-nb-400 uppercase tracking-wider mb-1">{stat.label}</p>
                  <p className="text-2xl font-bold text-white font-mono">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Grouped by date */}
          {Object.entries(grouped)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, snaps]) => (
              <Card key={date}>
                <CardHeader className="border-b border-border py-3">
                  <CardTitle className="text-xs font-semibold text-nb-400 uppercase tracking-wider">
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                    <span className="ml-2 font-normal text-nb-500">({snaps!.length} snapshots)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border">
                          {['Event', 'Source', 'Type', 'Home', 'Away', 'Time'].map((h) => (
                            <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {snaps!.slice(0, 10).map((snap) => (
                          <tr key={snap.id} className="border-b border-border/50 hover:bg-nb-800/20 transition-colors">
                            <td className="px-4 py-2.5">
                              <p className="text-xs font-medium text-white">{(snap as any).event?.title ?? '—'}</p>
                              <p className="text-[10px] text-nb-500">{(snap as any).event?.league?.abbreviation}</p>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-nb-300">{(snap as any).source?.name}</td>
                            <td className="px-4 py-2.5">
                              <Badge variant="muted" className="text-[10px] capitalize">{snap.market_type}</Badge>
                            </td>
                            <td className="px-4 py-2.5 text-xs font-mono text-white">{formatOdds(snap.home_price)}</td>
                            <td className="px-4 py-2.5 text-xs font-mono text-nb-300">{formatOdds(snap.away_price)}</td>
                            <td className="px-4 py-2.5 text-[10px] font-mono text-nb-500">{formatRelativeTime(snap.snapshot_time)}</td>
                          </tr>
                        ))}
                        {snaps!.length > 10 && (
                          <tr>
                            <td colSpan={6} className="px-4 py-2 text-center text-[10px] text-nb-500">
                              +{snaps!.length - 10} more snapshots
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            ))}
          {Object.keys(grouped).length === 0 && (
            <div className="text-center py-12 text-sm text-nb-400">No historical data available</div>
          )}
        </div>
      </ProGate>
    </div>
  )
}
