import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { MarketComparisonSection } from '@/components/markets/market-comparison-section'
import { PropComparisonSection } from '@/components/markets/prop-comparison-section'
import { formatEventTime, formatRelativeTime, getMarketShape } from '@/lib/utils'
import { isUpcomingEvent } from '@/lib/queries'
import type { MarketSnapshot } from '@/types'

export const dynamic = 'force-dynamic'

// Ordered list of market types to display
const MARKET_TYPE_ORDER = ['moneyline', 'spread', 'total', 'prop', 'futures']

function parseTeams(title: string): { home: string; away: string } {
  const parts = title.split(' vs ')
  if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() }
  return { home: title, away: '' }
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { eventId } = await params

  // Fetch the event
  const { data: eventRaw } = await supabase
    .from('events')
    .select('id, title, start_time, status, league_id, league:leagues(id, name, abbreviation, slug, sport_id, sport:sports(slug))')
    .eq('id', eventId)
    .single()

  if (!eventRaw) notFound()

  const event = eventRaw as any

  // Guard: this app is pre-game only. Show unavailable state for started events.
  if (!isUpcomingEvent(event.start_time)) {
    return (
      <div className="p-6 space-y-6 max-w-[1100px]">
        <Link
          href="/markets"
          className="inline-flex items-center gap-1.5 text-xs text-nb-400 hover:text-nb-200 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Markets
        </Link>
        <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-16 text-center space-y-3">
          <p className="text-sm font-semibold text-white">{event.title}</p>
          <p className="text-xs text-nb-400 max-w-sm mx-auto leading-relaxed">
            This event is no longer available in the pre-game dashboard.
            Only upcoming events are shown.
          </p>
          <Link
            href="/markets"
            className="inline-flex items-center gap-1.5 text-xs text-nb-300 hover:text-white transition-colors underline"
          >
            View upcoming events
          </Link>
        </div>
      </div>
    )
  }

  // Fetch snapshots for this event from the last 6 hours, newest first
  const snapshotCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: snapshotsRaw } = await supabase
    .from('market_snapshots')
    .select('*, source:market_sources(id, name, slug, source_type)')
    .eq('event_id', eventId)
    .gt('snapshot_time', snapshotCutoff)
    .order('snapshot_time', { ascending: false })

  const allSnapshots = (snapshotsRaw ?? []) as MarketSnapshot[]

  // Deduplicate: for each (source_id, market_type) pair, keep only the latest snapshot
  const seen = new Set<string>()
  const latestSnapshots = allSnapshots.filter(s => {
    const key = `${s.source_id}:${s.market_type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Group by market_type
  const byMarketType = new Map<string, MarketSnapshot[]>()
  for (const snap of latestSnapshots) {
    const group = byMarketType.get(snap.market_type) ?? []
    byMarketType.set(snap.market_type, [...group, snap])
  }

  // Collect market types present, in preferred display order
  const marketTypes = [
    ...MARKET_TYPE_ORDER.filter(t => byMarketType.has(t)),
    ...Array.from(byMarketType.keys()).filter(t => !MARKET_TYPE_ORDER.includes(t)),
  ]

  // Determine market shape (2-way vs 3-way)
  const leagueSlug = event.league?.slug ?? null
  const sportSlug = event.league?.sport?.slug ?? null
  const moneylineShape = getMarketShape(leagueSlug, sportSlug, 'moneyline')
  const isThreeWay = moneylineShape === '3way'

  // Fetch prop odds for this event
  const { data: propOddsRaw } = await supabase
    .from('prop_odds')
    .select('*, source:market_sources(id, name, slug)')
    .eq('event_id', eventId)
    .gt('snapshot_time', snapshotCutoff)

  const propOdds = (propOddsRaw ?? []).map((p: any) => ({
    source_id: p.source_id,
    source_name: p.source?.name ?? '—',
    source_slug: p.source?.slug ?? '',
    prop_category: p.prop_category,
    player_name: p.player_name,
    line_value: p.line_value,
    over_price: p.over_price,
    under_price: p.under_price,
    yes_price: p.yes_price,
    no_price: p.no_price,
    snapshot_time: p.snapshot_time,
  }))

  // Stats for header
  const sourceCount = new Set([
    ...latestSnapshots.map(s => s.source_id),
    ...propOdds.map((p: any) => p.source_id),
  ]).size
  const lastUpdated = allSnapshots[0]?.snapshot_time ?? null

  const { home, away } = parseTeams(event.title)

  return (
    <div className="p-6 space-y-6 max-w-[1100px]">
      {/* Back nav */}
      <Link
        href="/markets"
        className="inline-flex items-center gap-1.5 text-xs text-nb-400 hover:text-nb-200 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Markets
      </Link>

      {/* Event header */}
      <div className="rounded-lg border border-border bg-nb-900/40 p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-white leading-tight">{event.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {event.league && (
                <Badge variant="muted" className="text-[10px]">
                  {event.league.abbreviation ?? event.league.name}
                </Badge>
              )}
              {isThreeWay && (
                <Badge variant="muted" className="text-[10px] text-nb-400">
                  3-way market
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right space-y-1 shrink-0">
            <p className="text-xs text-nb-300 font-mono whitespace-nowrap">
              {formatEventTime(event.start_time)}
            </p>
            {lastUpdated && (
              <p className="text-[10px] text-nb-500">
                Updated {formatRelativeTime(lastUpdated)}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-1 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-nb-500 uppercase tracking-wider">Sources</span>
            <span className="text-xs font-semibold text-white">{sourceCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-nb-500 uppercase tracking-wider">Markets</span>
            <span className="text-xs font-semibold text-white">{marketTypes.length}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {marketTypes.map(t => (
              <Badge key={t} variant="muted" className="text-[10px] capitalize">{t}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* No data state */}
      {marketTypes.length === 0 && (
        <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-12 text-center">
          <p className="text-sm text-nb-400">No market data available for this event yet.</p>
          <p className="text-xs text-nb-600 mt-1">Data syncs hourly — check back soon.</p>
        </div>
      )}

      {/* Market comparison sections */}
      {marketTypes.map(marketType => (
        <MarketComparisonSection
          key={marketType}
          marketType={marketType}
          snapshots={byMarketType.get(marketType) ?? []}
          homeTeam={home}
          awayTeam={away}
          isThreeWay={isThreeWay}
        />
      ))}

      {/* Prop comparison section */}
      <PropComparisonSection props={propOdds} />
    </div>
  )
}
