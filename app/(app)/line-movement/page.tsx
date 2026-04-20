import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProGate } from '@/components/shared/pro-gate'
import { MovementChart } from '@/components/line-movement/movement-chart'
import { LineMovementTable } from '@/components/line-movement/movement-table'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Line Movement' }

export default async function LineMovementPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('subscription_tier, subscription_status').eq('id', user.id).single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const { data: snapshots } = await supabase
    .from('market_snapshots')
    .select(`
      *,
      event:events(id, title, start_time, status, league:leagues(name, abbreviation)),
      source:market_sources(id, name, slug)
    `)
    .order('snapshot_time', { ascending: false })
    .limit(isPro ? 500 : 50)

  // Group by event for biggest movers
  const moversMap = new Map<string, typeof snapshots>()
  snapshots?.forEach((snap) => {
    const key = snap.event_id
    if (!moversMap.has(key)) moversMap.set(key, [])
    moversMap.get(key)!.push(snap)
  })

  const biggestMovers = Array.from(moversMap.entries())
    .map(([eventId, snaps]) => ({
      eventId,
      snaps: snaps!,
      event: (snaps![0] as any).event,
      maxMagnitude: Math.max(...snaps!.map((s) => s.movement_magnitude ?? 0)),
      latestSnap: snaps![0],
    }))
    .filter((m) => m.event != null)
    .sort((a, b) => b.maxMagnitude - a.maxMagnitude)
    .slice(0, 10)

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1200px]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Line Movement</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">Historical price movement across all tracked markets</p>
      </div>

      <ProGate isPro={isPro} featureName="Line Movement" blur={false}>
        <div className="space-y-6">
          {biggestMovers[0] && (
            <MovementChart
              event={biggestMovers[0].event}
              snapshots={biggestMovers[0].snaps}
            />
          )}
          <LineMovementTable movers={biggestMovers} />
        </div>
      </ProGate>
    </div>
  )
}
