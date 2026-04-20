import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatRelativeTime } from '@/lib/utils'
import { Activity, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'

export const metadata = { title: 'Admin · Data Health' }

export default async function DataHealthPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/dashboard')

  const [{ data: sources }, { data: recentSnaps }] = await Promise.all([
    supabase.from('market_sources').select('*').order('display_order'),
    supabase
      .from('market_snapshots')
      .select('source_id, snapshot_time')
      .order('snapshot_time', { ascending: false })
      .limit(200),
  ])

  // Last snapshot time per source
  const lastSnapBySource = recentSnaps?.reduce((acc, snap) => {
    if (!acc[snap.source_id]) acc[snap.source_id] = snap.snapshot_time
    return acc
  }, {} as Record<string, string>)

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[900px]">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-nb-400" />
        <h1 className="text-lg font-bold text-white">Data Source Health</h1>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Healthy', value: sources?.filter(s => s.health_status === 'healthy').length ?? 0, icon: CheckCircle, color: 'text-white' },
          { label: 'Degraded', value: sources?.filter(s => s.health_status === 'degraded').length ?? 0, icon: AlertTriangle, color: 'text-nb-300' },
          { label: 'Down', value: sources?.filter(s => s.health_status === 'down').length ?? 0, icon: XCircle, color: 'text-nb-400' },
        ].map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                <Icon className={`h-5 w-5 ${stat.color}`} />
                <div>
                  <p className="text-[10px] text-nb-400 uppercase tracking-wider">{stat.label}</p>
                  <p className="text-xl font-bold text-white font-mono">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle>Source Status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {sources?.map((source) => {
              const lastSnap = lastSnapBySource?.[source.id]
              return (
                <div key={source.id} className="flex items-center justify-between px-5 py-4 hover:bg-nb-800/20 transition-colors">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-white">{source.name}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{source.source_type}</Badge>
                      {!source.is_active && <Badge variant="muted" className="text-[10px]">Disabled</Badge>}
                    </div>
                    <p className="text-xs text-nb-400">
                      Last data: {lastSnap ? formatRelativeTime(lastSnap) : 'Never'}
                    </p>
                  </div>
                  <Badge
                    variant={
                      source.health_status === 'healthy' ? 'healthy' :
                      source.health_status === 'degraded' ? 'degraded' : 'muted'
                    }
                    className="text-[10px] capitalize"
                  >
                    {source.health_status}
                  </Badge>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
