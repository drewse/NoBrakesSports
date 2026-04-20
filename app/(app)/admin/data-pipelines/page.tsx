import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity, CheckCircle2, XCircle, AlertTriangle, Database } from 'lucide-react'
import { PipelineRow, type Pipeline } from './pipeline-actions'

export const metadata = { title: 'Data Pipelines — Admin' }

const REGION_LABELS: Record<string, string> = {
  us: 'US', ca: 'CA', us_ca: 'US / CA', ontario: 'Ontario', global: 'Global',
}

export default async function DataPipelinesPage() {
  const supabase = await createClient()

  // ── Auth + admin guard ───────────────────────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) redirect('/dashboard')

  // ── Data ─────────────────────────────────────────────────────────────────
  const [pipelinesRes, recentRunsRes, sourcesRes] = await Promise.all([
    supabase
      .from('data_pipelines')
      .select('*')
      .order('priority', { ascending: true }),
    supabase
      .from('pipeline_runs')
      .select('pipeline_slug, status, is_no_op, snapshots_changed, snapshots_skipped, started_at, finished_at, timed_out')
      .order('started_at', { ascending: false })
      .limit(200),
    // Get event and market counts per source from current_market_odds
    supabase
      .from('market_sources')
      .select('id, slug'),
  ])

  const { data: pipelines }    = pipelinesRes
  const recentRuns             = (recentRunsRes.data ?? []) as any[]
  const allSources             = (sourcesRes.data ?? []) as { id: string; slug: string }[]

  // Build source id → slug map
  const slugBySourceId = new Map<string, string>()
  for (const s of allSources) slugBySourceId.set(s.id, s.slug)

  // Fetch ALL market rows in ONE query to compute per-source stats + health.
  const sourceStats = new Map<string, { events: number; markets: number; fullCoverage: number; missingMarkets: number; stale: number }>()
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const staleCutoff = Date.now() - 30 * 60 * 1000 // 30 min

  // Fetch in parallel: moneyline rows for events, all rows for health stats
  const [{ data: allMarketRows }] = await Promise.all([
    supabase
      .from('current_market_odds')
      .select('source_id, event_id, market_type, snapshot_time')
      .gt('snapshot_time', cutoff)
      .limit(20000),
  ])

  // Aggregate per source
  // Track: per (source, event) → which market types exist + latest snapshot
  const sourceEventData = new Map<string, Map<string, { types: Set<string>; latest: string }>>()
  for (const row of allMarketRows ?? []) {
    if (!sourceEventData.has(row.source_id)) sourceEventData.set(row.source_id, new Map())
    const eventMap = sourceEventData.get(row.source_id)!
    if (!eventMap.has(row.event_id)) eventMap.set(row.event_id, { types: new Set(), latest: row.snapshot_time })
    const ev = eventMap.get(row.event_id)!
    ev.types.add(row.market_type)
    if (row.snapshot_time > ev.latest) ev.latest = row.snapshot_time
  }

  for (const s of allSources) {
    const eventMap = sourceEventData.get(s.id)
    if (!eventMap) {
      sourceStats.set(s.slug, { events: 0, markets: 0, fullCoverage: 0, missingMarkets: 0, stale: 0 })
      continue
    }
    let totalMarkets = 0
    let fullCoverage = 0
    let missingMarkets = 0
    let stale = 0
    for (const [, data] of eventMap) {
      totalMarkets += data.types.size
      const hasFull = data.types.has('moneyline') && data.types.has('spread') && data.types.has('total')
      if (hasFull) fullCoverage++
      else missingMarkets++
      if (new Date(data.latest).getTime() < staleCutoff) stale++
    }
    sourceStats.set(s.slug, { events: eventMap.size, markets: totalMarkets, fullCoverage, missingMarkets, stale })
  }

  const all = (pipelines ?? []) as Pipeline[]

  const total    = all.length
  const active   = all.filter(p => p.is_enabled).length
  const disabled = all.filter(p => !p.is_enabled).length
  const errors   = all.filter(p => p.status === 'error').length
  const planned  = all.filter(p => p.status === 'planned').length
  const circuitOpen = all.filter(p => {
    if (!p.circuit_open_at) return false
    return (Date.now() - new Date(p.circuit_open_at).getTime()) < 60 * 60 * 1000
  }).length

  // No-op rate from recent runs (last 200): what fraction produced zero snapshot changes?
  const completedRuns = recentRuns.filter((r: any) => r.status !== 'running')
  const noOpRuns      = completedRuns.filter((r: any) => r.is_no_op)
  const noOpPct       = completedRuns.length > 0
    ? Math.round((noOpRuns.length / completedRuns.length) * 100)
    : null

  const summaryCards = [
    { label: 'Total Pipelines', value: total,    icon: Database,      color: 'text-nb-300' },
    { label: 'Active',          value: active,   icon: CheckCircle2,  color: 'text-green-400' },
    { label: 'Disabled',        value: disabled, icon: XCircle,       color: 'text-nb-500' },
    { label: 'Errors',          value: errors,   icon: AlertTriangle, color: 'text-red-400' },
  ]

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <Activity className="h-4 w-4 text-nb-400" />
            <h1 className="text-lg font-bold text-white">Data Pipelines</h1>
            <Badge variant="muted" className="text-[9px] py-0 px-1.5">ADMIN</Badge>
          </div>
          <p className="text-xs text-nb-500">
            Internal source status, health, and rollout tracking. Click any field to edit inline.
          </p>
        </div>

        {/* Prop sync indicator */}
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-medium shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-violet-300">Prop sync: <span className="font-semibold text-violet-200">every 2 min</span></span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {summaryCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-nb-900 border-nb-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="text-[10px] text-nb-500 uppercase tracking-wider font-semibold">{label}</span>
              </div>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Secondary stats row */}
      <div className="flex items-center gap-4 text-xs text-nb-500 flex-wrap">
        <span><span className="text-nb-300 font-medium">{planned}</span> planned</span>
        <span>·</span>
        <span><span className="text-nb-300 font-medium">{all.filter(p => p.status === 'inactive').length}</span> inactive</span>
        <span>·</span>
        <span><span className="text-nb-300 font-medium">{all.filter(p => p.health_status === 'healthy').length}</span> healthy</span>
        <span>·</span>
        <span><span className="text-nb-300 font-medium">{all.filter(p => p.ingestion_method != null).length}</span> with ingestion method</span>
        {circuitOpen > 0 && (
          <>
            <span>·</span>
            <span className="text-orange-400 font-medium">{circuitOpen} circuit{circuitOpen > 1 ? 's' : ''} open</span>
          </>
        )}
        {noOpPct !== null && (
          <>
            <span>·</span>
            <span title="% of recent runs that wrote zero new snapshot rows (odds unchanged)">
              <span className={`font-medium ${noOpPct > 80 ? 'text-green-400' : noOpPct > 50 ? 'text-nb-300' : 'text-amber-400'}`}>
                {noOpPct}%
              </span>{' '}
              no-op rate
            </span>
          </>
        )}
      </div>

      {/* Pipeline table */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nb-800">
                  {[
                    'Book / Source',
                    'Region',
                    'Status',
                    'Enabled',
                    'Events',
                    'Markets',
                    'Priority',
                    'Ingestion Method',
                    'Last Checked',
                    'Last Success',
                    'Last Error',
                    'Health',
                    'Notes',
                    'Run',
                  ].map(col => (
                    <th
                      key={col}
                      className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {all.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="px-4 py-12 text-center text-nb-500 text-xs">
                      No pipeline records found. Run migration 007 in Supabase SQL editor.
                    </td>
                  </tr>
                ) : (
                  all.map(pipeline => (
                    <PipelineRow
                      key={pipeline.id}
                      initial={pipeline}
                      stats={sourceStats.get(pipeline.slug) ?? { events: 0, markets: 0, fullCoverage: 0, missingMarkets: 0, stale: 0 }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Footer note */}
      <p className="text-[10px] text-nb-700 leading-relaxed">
        Kambi books (BetRivers, Unibet, LeoVegas) scrape every 2 min via prop sync cron.
        Direct API books need individual adapter implementation. See <a href="/admin" className="text-nb-500 underline">Book Tracker</a> for implementation roadmap.
      </p>
    </div>
  )
}
