import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MarketsEventTable } from '@/components/markets/markets-event-table'
import { MarketsFilters } from '@/components/markets/markets-filters'
import { TableSkeleton } from '@/components/shared/loading-skeleton'

export const metadata = { title: 'Markets' }

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; q?: string }>
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

  const { data: leaguesRaw } = await supabase
    .from('leagues')
    .select('id, name, abbreviation, sport_id, slug')
    .eq('is_active', true)
    .order('display_order')
  const leagues = (leaguesRaw ?? []) as any[]

  // Fetch scheduled events, optionally filtered by league
  let eventQuery = supabase
    .from('events')
    .select('id, title, start_time, status, league_id, league:leagues(id, name, abbreviation, slug)')
    .eq('status', 'scheduled')
    .order('start_time')
    .limit(isPro ? 300 : 60)

  if (params.league) {
    eventQuery = eventQuery.eq('league_id', params.league)
  }

  const { data: eventsRaw } = await eventQuery
  const events = (eventsRaw ?? []) as any[]

  // Fetch snapshot metadata (source/market counts) for those events
  const snapshotMeta: Array<{
    event_id: string
    source_id: string
    market_type: string
    snapshot_time: string
  }> = []

  if (events.length > 0) {
    const eventIds = events.map((e: any) => e.id)
    const { data } = await supabase
      .from('market_snapshots')
      .select('event_id, source_id, market_type, snapshot_time')
      .in('event_id', eventIds)
    if (data) snapshotMeta.push(...data)
  }

  // Aggregate per event: distinct sources, market types, latest snapshot
  const metaByEvent: Record<string, {
    sourceIds: Set<string>
    marketTypes: Set<string>
    lastUpdated: string
  }> = {}

  for (const snap of snapshotMeta) {
    if (!metaByEvent[snap.event_id]) {
      metaByEvent[snap.event_id] = {
        sourceIds: new Set(),
        marketTypes: new Set(),
        lastUpdated: snap.snapshot_time,
      }
    }
    const m = metaByEvent[snap.event_id]
    m.sourceIds.add(snap.source_id)
    m.marketTypes.add(snap.market_type)
    if (snap.snapshot_time > m.lastUpdated) m.lastUpdated = snap.snapshot_time
  }

  // Build event summaries
  let eventSummaries = events.map((event: any) => ({
    id: event.id,
    title: event.title,
    start_time: event.start_time,
    league: event.league as { name: string; abbreviation: string | null; slug: string } | null,
    league_id: event.league_id as string,
    sourceCount: metaByEvent[event.id]?.sourceIds.size ?? 0,
    marketTypes: Array.from(metaByEvent[event.id]?.marketTypes ?? []) as string[],
    lastUpdated: metaByEvent[event.id]?.lastUpdated ?? null,
  }))

  // Apply search filter server-side
  if (params.q) {
    const q = params.q.toLowerCase()
    eventSummaries = eventSummaries.filter(e => e.title.toLowerCase().includes(q))
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Markets</h1>
          <p className="text-xs text-nb-400 mt-0.5">
            {eventSummaries.length} upcoming events
            {!isPro && ' · Upgrade Pro for full access'}
          </p>
        </div>
      </div>

      <MarketsFilters
        leagues={leagues}
        sources={[]}
        currentLeague={params.league}
        currentSearch={params.q}
      />

      <Suspense fallback={<TableSkeleton rows={8} cols={6} />}>
        <MarketsEventTable events={eventSummaries} isPro={isPro} />
      </Suspense>
    </div>
  )
}
