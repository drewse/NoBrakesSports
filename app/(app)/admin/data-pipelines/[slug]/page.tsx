import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PipelineDetailClient } from './pipeline-detail-client'

export const metadata = { title: 'Pipeline Detail — Admin' }

type MarketOddsRow = {
  id: string
  event_id: string
  source_id: string
  market_type: string
  line_value: number | null
  home_price: number | null
  away_price: number | null
  draw_price: number | null
  spread_value: number | null
  total_value: number | null
  over_price: number | null
  under_price: number | null
  snapshot_time: string
  changed_at: string | null
  odds_hash: string | null
}

type PropOddsRow = {
  id: string
  event_id: string
  source_id: string
  prop_category: string
  player_name: string
  line_value: number | null
  over_price: number | null
  under_price: number | null
  snapshot_time: string
}

type EventRow = {
  id: string
  title: string
  start_time: string
  status: string
  league_id: string | null
}

type LeagueRow = {
  id: string
  name: string
  abbreviation: string | null
  slug: string
}

export type PipelineData = {
  id: string
  slug: string
  display_name: string
  source_type: string
  region: string
  is_enabled: boolean
  is_running: boolean
  status: string
  priority: number
  ingestion_method: string | null
  health_status: string
  notes: string | null
  last_checked_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  consecutive_failures: number
  circuit_open_at: string | null
}

export type EventWithMarkets = {
  event: EventRow
  league: LeagueRow | null
  markets: MarketOddsRow[]
  props: PropOddsRow[]
}

export default async function PipelineDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  // Auth + admin guard
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) redirect('/dashboard')

  // Fetch pipeline
  const { data: pipeline } = await supabase
    .from('data_pipelines')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!pipeline) notFound()

  // Fetch matching market source
  const { data: source } = await supabase
    .from('market_sources')
    .select('id, name, slug')
    .eq('slug', slug)
    .single()

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  let marketOdds: MarketOddsRow[] = []
  let propOdds: PropOddsRow[] = []

  if (source) {
    // Fetch market odds in batches
    let allMarkets: MarketOddsRow[] = []
    let offset = 0
    const batchSize = 5000
    let hasMore = true
    while (hasMore) {
      const { data } = await supabase
        .from('current_market_odds')
        .select('*')
        .eq('source_id', source.id)
        .gt('snapshot_time', cutoff)
        .order('snapshot_time', { ascending: false })
        .range(offset, offset + batchSize - 1)

      const rows = (data ?? []) as MarketOddsRow[]
      allMarkets = allMarkets.concat(rows)
      hasMore = rows.length === batchSize
      offset += batchSize
    }
    marketOdds = allMarkets

    // Fetch prop odds
    let allProps: PropOddsRow[] = []
    offset = 0
    hasMore = true
    while (hasMore) {
      const { data } = await supabase
        .from('prop_odds')
        .select('*')
        .eq('source_id', source.id)
        .gt('snapshot_time', cutoff)
        .order('snapshot_time', { ascending: false })
        .range(offset, offset + batchSize - 1)

      const rows = (data ?? []) as PropOddsRow[]
      allProps = allProps.concat(rows)
      hasMore = rows.length === batchSize
      offset += batchSize
    }
    propOdds = allProps
  }

  // Collect unique event IDs
  const eventIds = new Set<string>()
  for (const m of marketOdds) eventIds.add(m.event_id)
  for (const p of propOdds) eventIds.add(p.event_id)

  // Fetch events
  const eventIdArr = Array.from(eventIds)
  let events: EventRow[] = []
  // Supabase .in() limit ~300, batch if needed
  for (let i = 0; i < eventIdArr.length; i += 300) {
    const batch = eventIdArr.slice(i, i + 300)
    const { data } = await supabase
      .from('events')
      .select('id, title, start_time, status, league_id')
      .in('id', batch)
    events = events.concat((data ?? []) as EventRow[])
  }

  // Fetch leagues
  const leagueIds = new Set<string>()
  for (const e of events) if (e.league_id) leagueIds.add(e.league_id)

  let leagues: LeagueRow[] = []
  const leagueIdArr = Array.from(leagueIds)
  for (let i = 0; i < leagueIdArr.length; i += 300) {
    const batch = leagueIdArr.slice(i, i + 300)
    const { data } = await supabase
      .from('leagues')
      .select('id, name, abbreviation, slug')
      .in('id', batch)
    leagues = leagues.concat((data ?? []) as LeagueRow[])
  }

  // Build lookup maps
  const eventMap = new Map(events.map(e => [e.id, e]))
  const leagueMap = new Map(leagues.map(l => [l.id, l]))

  // Group markets and props by event
  const marketsByEvent = new Map<string, MarketOddsRow[]>()
  for (const m of marketOdds) {
    if (!marketsByEvent.has(m.event_id)) marketsByEvent.set(m.event_id, [])
    marketsByEvent.get(m.event_id)!.push(m)
  }

  const propsByEvent = new Map<string, PropOddsRow[]>()
  for (const p of propOdds) {
    if (!propsByEvent.has(p.event_id)) propsByEvent.set(p.event_id, [])
    propsByEvent.get(p.event_id)!.push(p)
  }

  // Build final data structure
  const eventsWithMarkets: EventWithMarkets[] = eventIdArr
    .map(eid => {
      const event = eventMap.get(eid)
      if (!event) return null
      const league = event.league_id ? leagueMap.get(event.league_id) ?? null : null
      return {
        event,
        league,
        markets: marketsByEvent.get(eid) ?? [],
        props: propsByEvent.get(eid) ?? [],
      }
    })
    .filter((x): x is EventWithMarkets => x !== null)
    .sort((a, b) => new Date(a.event.start_time).getTime() - new Date(b.event.start_time).getTime())

  return (
    <PipelineDetailClient
      pipeline={pipeline as PipelineData}
      sourceId={source?.id ?? null}
      eventsWithMarkets={eventsWithMarkets}
      cutoffTime={cutoff}
    />
  )
}
