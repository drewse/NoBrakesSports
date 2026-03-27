import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MarketsTable } from '@/components/markets/markets-table'
import { MarketsFilters } from '@/components/markets/markets-filters'
import { TableSkeleton } from '@/components/shared/loading-skeleton'

export const metadata = { title: 'Markets' }

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; source?: string; type?: string; q?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const [{ data: leaguesRaw }, { data: sourcesRaw }] = await Promise.all([
    supabase.from('leagues').select('id, name, abbreviation, sport_id').eq('is_active', true).order('display_order'),
    supabase.from('market_sources').select('id, name, slug, source_type').eq('is_active', true).order('display_order'),
  ])
  const leagues = (leaguesRaw ?? []) as any[]
  const sources = (sourcesRaw ?? []) as any[]

  let query = supabase
    .from('market_snapshots')
    .select(`
      *,
      event:events(id, title, start_time, status, league_id, league:leagues(name, abbreviation)),
      source:market_sources(id, name, slug, source_type)
    `)
    .order('snapshot_time', { ascending: false })
    .limit(isPro ? 100 : 25)

  if (params.source) query = query.eq('source_id', params.source)
  if (params.type) query = query.eq('market_type', params.type)

  const { data: snapshots } = await query

  // Filter by league client-side since it's nested
  const filtered = params.league
    ? snapshots?.filter((s) => (s as any).event?.league_id === params.league)
    : snapshots

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Markets</h1>
          <p className="text-xs text-nb-400 mt-0.5">
            Real-time market data across {sources?.length ?? 0} sources
            {!isPro && ' · 24h delayed for free accounts'}
          </p>
        </div>
      </div>

      <MarketsFilters
        leagues={leagues ?? []}
        sources={sources ?? []}
        currentLeague={params.league}
        currentSource={params.source}
        currentType={params.type}
        currentSearch={params.q}
      />

      <Suspense fallback={<TableSkeleton rows={8} cols={7} />}>
        <MarketsTable snapshots={filtered ?? []} isPro={isPro} />
      </Suspense>
    </div>
  )
}
