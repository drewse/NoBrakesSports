import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StatCard } from '@/components/shared/stat-card'
import { DashboardMarketTable } from '@/components/dashboard/market-table'
import { DivergenceCard } from '@/components/dashboard/divergence-card'
import { WatchlistSummary } from '@/components/dashboard/watchlist-summary'
import { formatRelativeTime } from '@/lib/utils'
import { upcomingCutoff, isUpcomingEvent } from '@/lib/queries'

export const metadata = { title: 'Dashboard' }

export default async function DashboardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  // Fetch overview data
  const [
    { data: events },
    { data: sources },
    { data: predictions },
    { data: watchlist },
  ] = await Promise.all([
    supabase
      .from('events')
      .select('*, league:leagues(name, abbreviation), home_team:teams!events_home_team_id_fkey(name, abbreviation), away_team:teams!events_away_team_id_fkey(name, abbreviation)')
      .gt('start_time', upcomingCutoff())
      .order('start_time', { ascending: true })
      .limit(10),
    supabase.from('market_sources').select('*').eq('is_active', true).order('display_order'),
    supabase
      .from('prediction_market_snapshots')
      .select('*, event:events(title, start_time), source:market_sources(name)')
      .order('snapshot_time', { ascending: false })
      .limit(20),
    supabase
      .from('watchlist_items')
      .select('*, team:teams(name), league:leagues(name), event:events(title, start_time)')
      .limit(5),
  ])

  // Filter predictions to only those tied to upcoming events (or unmatched contracts)
  const upcomingPredictions = predictions?.filter(
    p => isUpcomingEvent((p as any).event?.start_time ?? null) || !(p as any).event
  ) ?? []

  const activeEvents = events?.length ?? 0
  const healthySources = sources?.filter(s => s.health_status === 'healthy').length ?? 0
  const totalSources = sources?.length ?? 0

  // Find biggest divergence among upcoming-only predictions
  const biggestDivergence = upcomingPredictions
    .filter(p => p.divergence_pct != null)
    .sort((a, b) => Math.abs(b.divergence_pct!) - Math.abs(a.divergence_pct!))[0]

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Overview</h1>
          <p className="text-xs text-nb-400 mt-0.5">
            Pre-game market intelligence · Updated {formatRelativeTime(new Date().toISOString())}
          </p>
        </div>
        {!isPro && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-nb-900 px-3 py-1.5">
            <span className="text-[11px] text-nb-400">Viewing delayed data</span>
            <span className="text-[11px] font-medium text-white underline cursor-pointer">Upgrade</span>
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Events"
          value={activeEvents}
          change={12}
          change_label="vs yesterday"
          trend="up"
        />
        <StatCard
          label="Market Sources"
          value={`${healthySources}/${totalSources}`}
          change_label="sources online"
          trend={healthySources === totalSources ? 'up' : 'down'}
        />
        <StatCard
          label="Top Divergence"
          value={biggestDivergence ? `${Math.abs(biggestDivergence.divergence_pct ?? 0).toFixed(1)}%` : '—'}
          change_label={biggestDivergence?.event?.title ?? 'No divergences'}
          trend={biggestDivergence ? 'up' : 'flat'}
        />
        <StatCard
          label="Watchlist Items"
          value={watchlist?.length ?? 0}
          trend="flat"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Markets table (2/3 width) */}
        <div className="lg:col-span-2">
          <DashboardMarketTable events={events ?? []} isPro={isPro} />
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <DivergenceCard predictions={upcomingPredictions.slice(0, 5)} />
          <WatchlistSummary items={watchlist ?? []} />
        </div>
      </div>
    </div>
  )
}
