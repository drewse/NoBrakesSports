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
  const { data: pipelines } = await supabase
    .from('data_pipelines')
    .select('*')
    .order('priority', { ascending: true })

  const { data: oddsFlag } = await supabase
    .from('feature_flags')
    .select('is_enabled')
    .eq('key', 'odds_api_sync')
    .single()

  const all = (pipelines ?? []) as Pipeline[]

  const total    = all.length
  const active   = all.filter(p => p.is_enabled).length
  const disabled = all.filter(p => !p.is_enabled).length
  const errors   = all.filter(p => p.status === 'error').length
  const planned  = all.filter(p => p.status === 'planned').length

  const oddsSyncEnabled = oddsFlag?.is_enabled ?? false

  const summaryCards = [
    { label: 'Total Pipelines', value: total,    icon: Database,      color: 'text-nb-300' },
    { label: 'Active',          value: active,   icon: CheckCircle2,  color: 'text-green-400' },
    { label: 'Disabled',        value: disabled, icon: XCircle,       color: 'text-nb-500' },
    { label: 'Errors',          value: errors,   icon: AlertTriangle, color: 'text-red-400' },
  ]

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
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

        {/* Odds API status pill */}
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shrink-0 ${
          oddsSyncEnabled
            ? 'border-green-500/30 bg-green-500/10 text-green-400'
            : 'border-nb-700 bg-nb-800 text-nb-400'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${oddsSyncEnabled ? 'bg-green-400' : 'bg-nb-600'}`} />
          The Odds API sync:
          <span className="font-semibold">{oddsSyncEnabled ? 'Enabled' : 'Disabled'}</span>
          <a href="/admin/feature-flags" className="ml-1 underline underline-offset-2 text-nb-500 hover:text-white text-[10px]">
            manage →
          </a>
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
      <div className="flex items-center gap-4 text-xs text-nb-500">
        <span><span className="text-nb-300 font-medium">{planned}</span> planned</span>
        <span>·</span>
        <span><span className="text-nb-300 font-medium">{all.filter(p => p.status === 'inactive').length}</span> inactive</span>
        <span>·</span>
        <span><span className="text-nb-300 font-medium">{all.filter(p => p.health_status === 'healthy').length}</span> healthy</span>
        <span>·</span>
        <span><span className="text-nb-300 font-medium">{all.filter(p => p.ingestion_method != null).length}</span> with ingestion method</span>
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
                    'Health',
                    'Priority',
                    'Ingestion Method',
                    'Last Checked',
                    'Last Success',
                    'Last Error',
                    'Notes',
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
                    <td colSpan={11} className="px-4 py-12 text-center text-nb-500 text-xs">
                      No pipeline records found. Run migration 007 in Supabase SQL editor.
                    </td>
                  </tr>
                ) : (
                  all.map(pipeline => (
                    <PipelineRow key={pipeline.id} initial={pipeline} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Footer note */}
      <p className="text-[10px] text-nb-700 leading-relaxed">
        All pipelines are in <span className="text-nb-500">planned</span> state pending scraper implementation.
        Enable / disable toggles are safe to use — no live ingestion will start until the ingestion method is set and the pipeline is wired up.
      </p>
    </div>
  )
}
