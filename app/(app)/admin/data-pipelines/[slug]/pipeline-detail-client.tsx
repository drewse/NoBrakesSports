'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Zap,
  Code2,
  BarChart3,
  TrendingUp,
  Users,
} from 'lucide-react'
import type { PipelineData, EventWithMarkets } from './page'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function fmtOdds(price: number | null): string {
  if (price == null) return '—'
  return price > 0 ? `+${price}` : String(price)
}

function isStale(snapshotTime: string): boolean {
  return Date.now() - new Date(snapshotTime).getTime() > 30 * 60 * 1000
}

function getLatestSnapshot(markets: { snapshot_time: string }[]): string | null {
  if (markets.length === 0) return null
  return markets.reduce((latest, m) =>
    m.snapshot_time > latest ? m.snapshot_time : latest
  , markets[0].snapshot_time)
}

// ── Status badge colors ──────────────────────────────────────────────────────

const STATUS_CLASSES: Record<string, string> = {
  planned: 'bg-nb-800 text-nb-400 border-nb-700',
  inactive: 'bg-nb-800 text-nb-500 border-nb-700',
  healthy: 'bg-green-500/15 text-green-400 border-green-500/30',
  warning: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
}

// ── Main component ───────────────────────────────────────────────────────────

export function PipelineDetailClient({
  pipeline,
  sourceId,
  eventsWithMarkets,
  cutoffTime,
}: {
  pipeline: PipelineData
  sourceId: string | null
  eventsWithMarkets: EventWithMarkets[]
  cutoffTime: string
}) {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const [showRawData, setShowRawData] = useState(false)
  const [showErrorMsg, setShowErrorMsg] = useState(false)

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalEvents = eventsWithMarkets.length
    let totalGameMarkets = 0
    let totalPropMarkets = 0
    let eventsWithML = 0
    let eventsWithSpread = 0
    let eventsWithTotal = 0
    let eventsAllThree = 0
    let eventsMissing = 0
    let staleEvents = 0

    for (const ew of eventsWithMarkets) {
      totalGameMarkets += ew.markets.length
      totalPropMarkets += ew.props.length

      const hasML = ew.markets.some(m => m.market_type === 'moneyline')
      const hasSpread = ew.markets.some(m => m.market_type === 'spread')
      const hasTotal = ew.markets.some(m => m.market_type === 'total')

      if (hasML) eventsWithML++
      if (hasSpread) eventsWithSpread++
      if (hasTotal) eventsWithTotal++
      if (hasML && hasSpread && hasTotal) eventsAllThree++
      if (!hasML || !hasSpread || !hasTotal) eventsMissing++

      const latest = getLatestSnapshot(ew.markets)
      if (latest && isStale(latest)) staleEvents++
    }

    return {
      totalEvents,
      totalGameMarkets,
      totalPropMarkets,
      eventsWithML,
      eventsWithSpread,
      eventsWithTotal,
      eventsAllThree,
      eventsMissing,
      staleEvents,
      mlPct: totalEvents > 0 ? Math.round((eventsWithML / totalEvents) * 100) : 0,
      spreadPct: totalEvents > 0 ? Math.round((eventsWithSpread / totalEvents) * 100) : 0,
      totalPct: totalEvents > 0 ? Math.round((eventsWithTotal / totalEvents) * 100) : 0,
    }
  }, [eventsWithMarkets])

  // ── Accordion toggle ─────────────────────────────────────────────────────

  function toggleEvent(eventId: string) {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(eventId)) next.delete(eventId)
      else next.add(eventId)
      return next
    })
  }

  // ── Circuit breaker ──────────────────────────────────────────────────────

  const circuitOpen = pipeline.circuit_open_at
    ? Date.now() - new Date(pipeline.circuit_open_at).getTime() < 60 * 60 * 1000
    : false

  return (
    <div className="p-6 space-y-6 max-w-[1400px]">
      {/* Back link */}
      <Link
        href="/admin/data-pipelines"
        className="inline-flex items-center gap-1.5 text-xs text-nb-500 hover:text-nb-300 transition-colors"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Pipelines
      </Link>

      {/* ── Pipeline Header Card ──────────────────────────────────────── */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-5 space-y-4">
          {/* Top row: name, status, controls */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Activity className="h-4 w-4 text-nb-400" />
                <h1 className="text-lg font-bold text-white">{pipeline.display_name}</h1>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border capitalize ${
                    STATUS_CLASSES[pipeline.status] ?? STATUS_CLASSES.inactive
                  }`}
                >
                  {pipeline.status}
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                    pipeline.is_enabled
                      ? 'bg-green-500/15 text-green-400 border-green-500/30'
                      : 'bg-nb-800 text-nb-500 border-nb-700'
                  }`}
                >
                  {pipeline.is_enabled ? 'Enabled' : 'Disabled'}
                </span>
                <Badge variant="muted" className="text-[9px] py-0 px-1.5">ADMIN</Badge>
              </div>
              <p className="text-[11px] text-nb-600 font-mono">{pipeline.slug}</p>
            </div>

            {/* Raw data toggle */}
            <button
              onClick={() => setShowRawData(!showRawData)}
              className={`flex items-center gap-1.5 text-[10px] font-medium border rounded px-3 py-1.5 transition-colors ${
                showRawData
                  ? 'text-white border-nb-600 bg-nb-800'
                  : 'text-nb-400 border-nb-700 hover:border-nb-500 hover:text-white'
              }`}
            >
              <Code2 className="h-3 w-3" />
              {showRawData ? 'Hide Raw Data' : 'Show Raw Data'}
            </button>
          </div>

          {/* Timestamps row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-nb-500 text-[10px] uppercase tracking-wider font-semibold block mb-0.5">Last Sync</span>
              <span className="text-nb-300 font-mono">{fmtTime(pipeline.last_checked_at)}</span>
            </div>
            <div>
              <span className="text-nb-500 text-[10px] uppercase tracking-wider font-semibold block mb-0.5">Last Success</span>
              <span className="text-green-400 font-mono">{fmtTime(pipeline.last_success_at)}</span>
            </div>
            <div>
              <span className="text-nb-500 text-[10px] uppercase tracking-wider font-semibold block mb-0.5">Last Error</span>
              <span className="text-red-400 font-mono">{fmtTime(pipeline.last_error_at)}</span>
            </div>
            <div>
              <span className="text-nb-500 text-[10px] uppercase tracking-wider font-semibold block mb-0.5">Source ID</span>
              <span className="text-nb-300 font-mono">{sourceId ?? '—'}</span>
            </div>
          </div>

          {/* Error message expandable */}
          {pipeline.last_error_message && (
            <div>
              <button
                onClick={() => setShowErrorMsg(!showErrorMsg)}
                className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                <AlertTriangle className="h-3 w-3" />
                <span>Last error message</span>
                {showErrorMsg ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {showErrorMsg && (
                <div className="mt-2 rounded-lg bg-nb-950 border border-red-500/20 p-3">
                  <p className="text-[11px] font-mono text-red-300 leading-relaxed whitespace-pre-wrap break-words">
                    {pipeline.last_error_message}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Circuit breaker */}
          {circuitOpen && (
            <div className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2 text-xs">
              <Zap className="h-3.5 w-3.5 text-orange-400" />
              <span className="text-orange-300 font-medium">
                Circuit breaker is OPEN — {pipeline.consecutive_failures} consecutive failures
              </span>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {[
              { label: 'Events', value: stats.totalEvents, icon: BarChart3, color: 'text-white' },
              { label: 'Game Markets', value: stats.totalGameMarkets.toLocaleString(), icon: TrendingUp, color: 'text-nb-300' },
              { label: 'Prop Markets', value: stats.totalPropMarkets.toLocaleString(), icon: Users, color: 'text-nb-300' },
              { label: 'ML Coverage', value: `${stats.mlPct}%`, icon: CheckCircle2, color: stats.mlPct > 80 ? 'text-green-400' : stats.mlPct > 50 ? 'text-amber-400' : 'text-red-400' },
              { label: 'Spread Cov.', value: `${stats.spreadPct}%`, icon: CheckCircle2, color: stats.spreadPct > 80 ? 'text-green-400' : stats.spreadPct > 50 ? 'text-amber-400' : 'text-red-400' },
              { label: 'Total Cov.', value: `${stats.totalPct}%`, icon: CheckCircle2, color: stats.totalPct > 80 ? 'text-green-400' : stats.totalPct > 50 ? 'text-amber-400' : 'text-red-400' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-lg bg-nb-950 border border-nb-800 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`h-3 w-3 ${color}`} />
                  <span className="text-[9px] text-nb-500 uppercase tracking-wider font-semibold">{label}</span>
                </div>
                <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Data Health Bar ────────────────────────────────────────────── */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-4">
          <h2 className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-3">Data Health</h2>
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
              <span className="text-nb-300">
                <span className="font-mono font-semibold text-green-400">{stats.eventsAllThree}</span>
                {' '}full coverage (ML + Spread + Total)
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
              <span className="text-nb-300">
                <span className="font-mono font-semibold text-amber-400">{stats.eventsMissing}</span>
                {' '}missing markets
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
              <span className="text-nb-300">
                <span className="font-mono font-semibold text-yellow-400">{stats.staleEvents}</span>
                {' '}stale (&gt;30min)
              </span>
            </div>
          </div>
          {/* Health bar visual */}
          {stats.totalEvents > 0 && (
            <div className="mt-3 flex rounded-full h-2 overflow-hidden bg-nb-800">
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${(stats.eventsAllThree / stats.totalEvents) * 100}%` }}
              />
              <div
                className="bg-amber-500 transition-all"
                style={{ width: `${(stats.eventsMissing / stats.totalEvents) * 100}%` }}
              />
              <div
                className="bg-yellow-500 transition-all"
                style={{ width: `${(stats.staleEvents / stats.totalEvents) * 100}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Games List ─────────────────────────────────────────────────── */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-0">
          <div className="px-4 py-3 border-b border-nb-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-nb-400 uppercase tracking-wider">
              Events ({stats.totalEvents})
            </h2>
            <span className="text-[10px] text-nb-600">Last 6 hours from {fmtTime(cutoffTime)}</span>
          </div>

          {eventsWithMarkets.length === 0 ? (
            <div className="px-4 py-12 text-center text-nb-500 text-xs">
              No market data found for this pipeline in the last 6 hours.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nb-800">
                    {['', 'Game', 'League', 'Start Time', 'Moneyline', 'Spread', 'Total', 'Props', 'Last Updated', ''].map(col => (
                      <th
                        key={col || Math.random()}
                        className="px-3 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {eventsWithMarkets.map(ew => (
                    <EventRowBlock
                      key={ew.event.id}
                      ew={ew}
                      isExpanded={expandedEvents.has(ew.event.id)}
                      onToggle={() => toggleEvent(ew.event.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Raw Data ───────────────────────────────────────────────────── */}
      {showRawData && (
        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-4">
            <h2 className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-3">
              Raw Data ({stats.totalGameMarkets} market rows, {stats.totalPropMarkets} prop rows)
            </h2>
            <RawDataView eventsWithMarkets={eventsWithMarkets} />
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <p className="text-[10px] text-nb-700 leading-relaxed">
        Showing data from the last 6 hours. All timestamps in local browser time.
        Cutoff: {cutoffTime}
      </p>
    </div>
  )
}

// ── Event Row Block ──────────────────────────────────────────────────────────

function EventRowBlock({
  ew,
  isExpanded,
  onToggle,
}: {
  ew: EventWithMarkets
  isExpanded: boolean
  onToggle: () => void
}) {
  const ml = ew.markets.filter(m => m.market_type === 'moneyline')
  const spreads = ew.markets.filter(m => m.market_type === 'spread')
  const totals = ew.markets.filter(m => m.market_type === 'total')

  // Primary moneyline (line_value = null or first)
  const primaryML = ml[0]
  // Primary spread (most common line_value)
  const primarySpread = spreads[0]
  // Primary total
  const primaryTotal = totals[0]

  const latest = getLatestSnapshot([...ew.markets, ...ew.props])
  const stale = latest ? isStale(latest) : false

  const gameStarted = new Date(ew.event.start_time).getTime() < Date.now()

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-nb-800/50 hover:bg-nb-800/30 cursor-pointer transition-colors"
      >
        {/* Expand chevron */}
        <td className="px-3 py-2.5 w-8">
          {isExpanded
            ? <ChevronDown className="h-3.5 w-3.5 text-nb-500" />
            : <ChevronRight className="h-3.5 w-3.5 text-nb-500" />
          }
        </td>

        {/* Game title */}
        <td className="px-3 py-2.5 max-w-[250px]">
          <p className="text-xs font-medium text-white truncate">{ew.event.title}</p>
          <p className="text-[10px] text-nb-600 font-mono">{ew.event.id.slice(0, 8)}...</p>
        </td>

        {/* League */}
        <td className="px-3 py-2.5">
          {ew.league ? (
            <span className="text-[10px] font-semibold text-nb-400 uppercase">
              {ew.league.abbreviation ?? ew.league.name}
            </span>
          ) : (
            <span className="text-[10px] text-nb-700">—</span>
          )}
        </td>

        {/* Start time */}
        <td className="px-3 py-2.5">
          <span className={`text-[11px] font-mono ${gameStarted ? 'text-nb-500' : 'text-nb-300'}`}>
            {new Date(ew.event.start_time).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          {gameStarted && (
            <span className="ml-1.5 text-[9px] text-amber-400 font-semibold uppercase">Live</span>
          )}
        </td>

        {/* Moneyline */}
        <td className="px-3 py-2.5">
          {primaryML ? (
            <span className="font-mono text-[11px] text-nb-300">
              {fmtOdds(primaryML.home_price)} / {fmtOdds(primaryML.away_price)}
              {primaryML.draw_price != null && ` / ${fmtOdds(primaryML.draw_price)}`}
            </span>
          ) : (
            <span className="text-[10px] text-nb-700">—</span>
          )}
        </td>

        {/* Spread */}
        <td className="px-3 py-2.5">
          {primarySpread ? (
            <span className="font-mono text-[11px] text-nb-300">
              {primarySpread.spread_value != null ? `${primarySpread.spread_value > 0 ? '+' : ''}${primarySpread.spread_value}` : ''}{' '}
              ({fmtOdds(primarySpread.home_price)}/{fmtOdds(primarySpread.away_price)})
              {spreads.length > 1 && (
                <span className="text-nb-600 ml-1">+{spreads.length - 1}</span>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-nb-700">—</span>
          )}
        </td>

        {/* Total */}
        <td className="px-3 py-2.5">
          {primaryTotal ? (
            <span className="font-mono text-[11px] text-nb-300">
              {primaryTotal.total_value != null ? `${primaryTotal.total_value}` : ''}{' '}
              ({fmtOdds(primaryTotal.over_price)}/{fmtOdds(primaryTotal.under_price)})
              {totals.length > 1 && (
                <span className="text-nb-600 ml-1">+{totals.length - 1}</span>
              )}
            </span>
          ) : (
            <span className="text-[10px] text-nb-700">—</span>
          )}
        </td>

        {/* Props count */}
        <td className="px-3 py-2.5 text-center">
          {ew.props.length > 0 ? (
            <span className="font-mono text-[11px] text-violet-400 font-semibold">{ew.props.length}</span>
          ) : (
            <span className="font-mono text-[11px] text-nb-700">0</span>
          )}
        </td>

        {/* Last updated */}
        <td className="px-3 py-2.5">
          {latest ? (
            <div className="flex items-center gap-1.5">
              <Clock className={`h-3 w-3 ${stale ? 'text-yellow-500' : 'text-nb-600'}`} />
              <span className={`font-mono text-[10px] ${stale ? 'text-yellow-400' : 'text-nb-400'}`}>
                {fmtTime(latest)}
              </span>
              {stale && (
                <span className="text-[8px] font-semibold text-yellow-500 uppercase bg-yellow-500/10 px-1 py-0.5 rounded">
                  Stale
                </span>
              )}
            </div>
          ) : (
            <span className="text-[10px] text-nb-700">—</span>
          )}
        </td>

        {/* Status badges */}
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-1">
            {ml.length > 0 && <span className="text-[8px] font-bold text-green-400 bg-green-500/10 px-1 py-0.5 rounded">ML</span>}
            {spreads.length > 0 && <span className="text-[8px] font-bold text-green-400 bg-green-500/10 px-1 py-0.5 rounded">SP</span>}
            {totals.length > 0 && <span className="text-[8px] font-bold text-green-400 bg-green-500/10 px-1 py-0.5 rounded">TL</span>}
            {ew.props.length > 0 && <span className="text-[8px] font-bold text-violet-400 bg-violet-500/10 px-1 py-0.5 rounded">PR</span>}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr>
          <td colSpan={10} className="bg-nb-950 border-b border-nb-800">
            <ExpandedGameView ew={ew} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Expanded Game View ───────────────────────────────────────────────────────

function ExpandedGameView({ ew }: { ew: EventWithMarkets }) {
  const ml = ew.markets.filter(m => m.market_type === 'moneyline')
  const spreads = ew.markets.filter(m => m.market_type === 'spread')
  const totals = ew.markets.filter(m => m.market_type === 'total')

  // Group props by category
  const propsByCategory = new Map<string, typeof ew.props>()
  for (const p of ew.props) {
    if (!propsByCategory.has(p.prop_category)) propsByCategory.set(p.prop_category, [])
    propsByCategory.get(p.prop_category)!.push(p)
  }

  return (
    <div className="px-6 py-4 space-y-4">
      {/* Moneyline section */}
      {ml.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider mb-2">
            Moneyline ({ml.length} row{ml.length !== 1 ? 's' : ''})
          </h3>
          <div className="rounded-lg bg-nb-900 border border-nb-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-nb-800">
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Line Value</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Home</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Away</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Draw</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {ml.map((m, i) => (
                  <tr key={`ml-${i}`} className="border-b border-nb-800/50">
                    <td className="px-3 py-1.5 font-mono text-nb-400">{m.line_value ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-green-400">{fmtOdds(m.home_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-red-400">{fmtOdds(m.away_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-nb-300">{fmtOdds(m.draw_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-nb-600 text-[10px]">{fmtTime(m.snapshot_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Spread section */}
      {spreads.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider mb-2">
            Spread ({spreads.length} line{spreads.length !== 1 ? 's' : ''})
          </h3>
          <div className="rounded-lg bg-nb-900 border border-nb-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-nb-800">
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Spread</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Home</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Away</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {spreads.map((m, i) => (
                  <tr key={`sp-${i}`} className="border-b border-nb-800/50">
                    <td className="px-3 py-1.5 font-mono text-white font-semibold">
                      {m.spread_value != null ? `${m.spread_value > 0 ? '+' : ''}${m.spread_value}` : '—'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-green-400">{fmtOdds(m.home_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-red-400">{fmtOdds(m.away_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-nb-600 text-[10px]">{fmtTime(m.snapshot_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Total section */}
      {totals.length > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider mb-2">
            Total ({totals.length} line{totals.length !== 1 ? 's' : ''})
          </h3>
          <div className="rounded-lg bg-nb-900 border border-nb-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-nb-800">
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Total</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Over</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Under</th>
                  <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {totals.map((m, i) => (
                  <tr key={`tl-${i}`} className="border-b border-nb-800/50">
                    <td className="px-3 py-1.5 font-mono text-white font-semibold">{m.total_value ?? '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-green-400">{fmtOdds(m.over_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-red-400">{fmtOdds(m.under_price)}</td>
                    <td className="px-3 py-1.5 font-mono text-nb-600 text-[10px]">{fmtTime(m.snapshot_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Props section */}
      {propsByCategory.size > 0 && (
        <div>
          <h3 className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider mb-2">
            Player Props ({ew.props.length} total, {propsByCategory.size} categories)
          </h3>
          <div className="space-y-2">
            {Array.from(propsByCategory.entries()).map(([category, props]) => (
              <PropCategorySection key={category} category={category} props={props} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {ml.length === 0 && spreads.length === 0 && totals.length === 0 && ew.props.length === 0 && (
        <p className="text-xs text-nb-600 italic">No market data for this event.</p>
      )}
    </div>
  )
}

// ── Prop Category Section (collapsible) ──────────────────────────────────────

function PropCategorySection({
  category,
  props,
}: {
  category: string
  props: EventWithMarkets['props']
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg bg-nb-900 border border-nb-800 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-nb-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3 w-3 text-nb-500" /> : <ChevronRight className="h-3 w-3 text-nb-500" />}
          <span className="text-[11px] font-semibold text-violet-400 capitalize">{category.replace(/_/g, ' ')}</span>
        </div>
        <span className="text-[10px] text-nb-500 font-mono">{props.length} props</span>
      </button>
      {open && (
        <table className="w-full text-xs border-t border-nb-800">
          <thead>
            <tr className="border-b border-nb-800">
              <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Player</th>
              <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Line</th>
              <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Over</th>
              <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Under</th>
              <th className="px-3 py-1.5 text-left text-[9px] text-nb-500 font-semibold uppercase">Snapshot</th>
            </tr>
          </thead>
          <tbody>
            {props.map((p, i) => (
              <tr key={`prop-${i}`} className="border-b border-nb-800/50">
                <td className="px-3 py-1.5 text-nb-300">{p.player_name}</td>
                <td className="px-3 py-1.5 font-mono text-white font-semibold">{p.line_value ?? '—'}</td>
                <td className="px-3 py-1.5 font-mono text-green-400">{fmtOdds(p.over_price)}</td>
                <td className="px-3 py-1.5 font-mono text-red-400">{fmtOdds(p.under_price)}</td>
                <td className="px-3 py-1.5 font-mono text-nb-600 text-[10px]">{fmtTime(p.snapshot_time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── Raw Data View ────────────────────────────────────────────────────────────

function RawDataView({ eventsWithMarkets }: { eventsWithMarkets: EventWithMarkets[] }) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())

  function toggleSection(id: string) {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-2 max-h-[600px] overflow-y-auto">
      {eventsWithMarkets.map(ew => {
        const id = ew.event.id
        const isOpen = expandedSections.has(id)
        return (
          <div key={id} className="rounded-lg bg-nb-950 border border-nb-800">
            <button
              onClick={() => toggleSection(id)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-nb-800/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown className="h-3 w-3 text-nb-500" /> : <ChevronRight className="h-3 w-3 text-nb-500" />}
                <span className="text-[11px] font-mono text-nb-300">{ew.event.title}</span>
              </div>
              <span className="text-[10px] text-nb-600 font-mono">
                {ew.markets.length}m + {ew.props.length}p
              </span>
            </button>
            {isOpen && (
              <pre className="px-3 pb-3 text-[10px] font-mono text-nb-400 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-[400px] overflow-y-auto">
                {JSON.stringify(
                  {
                    event: ew.event,
                    league: ew.league,
                    markets: ew.markets,
                    props: ew.props,
                  },
                  null,
                  2
                )}
              </pre>
            )}
          </div>
        )
      })}
    </div>
  )
}
