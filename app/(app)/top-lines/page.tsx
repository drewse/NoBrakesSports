import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProGate } from '@/components/shared/pro-gate'
import {
  formatOdds,
  formatRelativeTime,
  formatDateTime,
  americanToImpliedProb,
  getMarketShape,
  formatSpread,
  type MarketShape,
} from '@/lib/utils'
import { isUpcomingEvent } from '@/lib/queries'

export const metadata = { title: 'Top EV Lines' }

const ABBREV_TO_SLUG: Record<string, string> = {
  EPL: 'epl',
  MLS: 'mls',
  'NCAA Soccer': 'ncaasoccer',
}

// ─── EV math ─────────────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1
}

function noVigProbs(
  homePrice: number,
  awayPrice: number,
  drawPrice: number | null
): { home: number; away: number; draw: number | null } {
  const h = americanToImpliedProb(homePrice)
  const a = americanToImpliedProb(awayPrice)
  const d = drawPrice != null ? americanToImpliedProb(drawPrice) : null
  const total = h + a + (d ?? 0)
  return { home: h / total, away: a / total, draw: d != null ? d / total : null }
}

function computeFairProbs(
  snaps: Array<{ home_price: number | null; away_price: number | null; draw_price?: number | null }>
): { home: number; away: number; draw: number | null } | null {
  const valid = snaps.filter(s => s.home_price != null && s.away_price != null)
  if (valid.length < 2) return null

  let sumH = 0, sumA = 0, sumD = 0, dCount = 0
  for (const s of valid) {
    const nvp = noVigProbs(s.home_price!, s.away_price!, s.draw_price ?? null)
    sumH += nvp.home
    sumA += nvp.away
    if (nvp.draw != null) { sumD += nvp.draw; dCount++ }
  }

  return {
    home: sumH / valid.length,
    away: sumA / valid.length,
    draw: dCount >= 2 ? sumD / dCount : null,
  }
}

function computeEv(fairProb: number, americanOdds: number): number {
  return (fairProb * americanToDecimal(americanOdds) - 1) * 100
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceOdds { name: string; price: number; evPct: number }

interface EvLine {
  eventTitle: string
  eventStart: string
  leagueAbbrev: string
  marketType: string
  outcomeSide: 'home' | 'away' | 'draw' | 'over'
  outcomeLabel: string       // e.g. "Golden State Warriors", "Wizards +9.5", "Over 228.5"
  lineValue: number | null   // spread or total value
  bestPrice: number
  bestSource: string
  evPct: number
  fairProb: number
  allSources: SourceOdds[]
  lastUpdated: string
  shape: MarketShape
  eventId: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function TopEvLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; market?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: snapshots } = await supabase
    .from('market_snapshots')
    .select(`
      id, event_id, source_id, market_type,
      home_price, away_price, draw_price,
      spread_value, total_value, snapshot_time,
      event:events(id, title, start_time, league:leagues(name, abbreviation, slug)),
      source:market_sources(id, name, slug)
    `)
    .gt('snapshot_time', cutoff)
    .in('market_type', ['moneyline', 'spread', 'total'])
    .order('snapshot_time', { ascending: false })
    .limit(isPro ? 5000 : 800)

  // ── Group by (event_id, market_type, lineValue) ──────────────────────────

  type Snap = NonNullable<typeof snapshots>[number]
  const groupMap = new Map<string, Snap[]>()

  for (const snap of snapshots ?? []) {
    const ev = (snap as any).event
    if (!ev) continue
    if (!isUpcomingEvent(ev.start_time)) continue

    const lineKey = snap.market_type === 'spread'
      ? String(snap.spread_value ?? '')
      : snap.market_type === 'total'
      ? String(snap.total_value ?? '')
      : ''

    const key = `${snap.event_id}::${snap.market_type}::${lineKey}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(snap)
  }

  // ── Compute EV lines from each group ─────────────────────────────────────

  const evLines: EvLine[] = []

  for (const snaps of groupMap.values()) {
    const event = (snaps[0] as any).event
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string = event?.league?.slug ?? ABBREV_TO_SLUG[leagueAbbrev] ?? ''
    const marketType = snaps[0].market_type as string
    const shape = getMarketShape(leagueSlug || null, null, marketType)

    const fair = computeFairProbs(snaps as any)
    if (!fair) continue  // need ≥ 2 sources with paired prices

    // Parse team names from "Home vs Away" title
    const titleParts = (event?.title ?? '').split(' vs ')
    const homeTeam = titleParts[0]?.trim() ?? 'Home'
    const awayTeam = titleParts[1]?.trim() ?? 'Away'

    const spreadVal = snaps[0].spread_value
    const totalVal = snaps[0].total_value

    const lastUpdated = snaps.reduce(
      (max, s) => s.snapshot_time > max ? s.snapshot_time : max,
      snaps[0].snapshot_time
    )

    // Helper to build a line from a specific outcome
    function buildLine(
      outcomeSide: EvLine['outcomeSide'],
      outcomeLabel: string,
      getPrice: (s: Snap) => number | null,
      fairProb: number | null
    ) {
      if (fairProb == null || fairProb === 0) return
      const relevant = snaps.filter(s => getPrice(s) != null)
      if (relevant.length === 0) return

      const allSources: SourceOdds[] = relevant.map(s => {
        const price = getPrice(s)!
        return {
          name: (s as any).source?.name ?? '?',
          price,
          evPct: computeEv(fairProb, price),
        }
      })
      allSources.sort((a, b) => b.evPct - a.evPct)

      const best = allSources[0]
      evLines.push({
        eventId: snaps[0].event_id,
        eventTitle: event?.title ?? '—',
        eventStart: event?.start_time ?? '',
        leagueAbbrev: leagueAbbrev || '—',
        marketType,
        outcomeSide,
        outcomeLabel,
        lineValue: spreadVal ?? totalVal ?? null,
        bestPrice: best.price,
        bestSource: best.name,
        evPct: best.evPct,
        fairProb,
        allSources,
        lastUpdated,
        shape,
      })
    }

    if (marketType === 'moneyline') {
      buildLine('home', homeTeam, s => s.home_price, fair.home)
      if (shape === '3way' && fair.draw != null) {
        buildLine('draw', 'Draw', s => s.draw_price ?? null, fair.draw)
      }
      buildLine('away', awayTeam, s => s.away_price, fair.away)

    } else if (marketType === 'spread' && spreadVal != null) {
      const awaySpreadVal = -spreadVal
      buildLine(
        'home',
        `${homeTeam} ${formatSpread(spreadVal)}`,
        s => s.home_price,
        fair.home
      )
      buildLine(
        'away',
        `${awayTeam} ${formatSpread(awaySpreadVal)}`,
        s => s.away_price,
        fair.away
      )

    } else if (marketType === 'total' && totalVal != null) {
      // Over is stored in home_price per sync convention
      buildLine('over', `Over ${totalVal}`, s => s.home_price, fair.home)
    }
  }

  // Sort by EV descending
  evLines.sort((a, b) => b.evPct - a.evPct)

  // ── Filters ───────────────────────────────────────────────────────────────

  const params = await searchParams
  const leagueFilter = params.league ?? 'all'
  const marketFilter = params.market ?? 'all'

  const leagues = Array.from(
    new Set(evLines.map(l => l.leagueAbbrev).filter(l => l && l !== '—'))
  ).sort()

  const filtered = evLines.filter(line => {
    const leagueMatch = leagueFilter === 'all' || line.leagueAbbrev === leagueFilter
    const marketMatch = marketFilter === 'all' || line.marketType === marketFilter
    return leagueMatch && marketMatch
  })

  const positiveCount = filtered.filter(l => l.evPct > 0).length
  const visibleLines = isPro ? filtered : filtered.slice(0, 10)
  const hiddenCount = filtered.length - visibleLines.length

  // ── Helpers ───────────────────────────────────────────────────────────────

  function evColor(ev: number): string {
    if (ev >= 5) return 'text-white font-bold'
    if (ev >= 2) return 'text-white'
    if (ev >= 0) return 'text-nb-300'
    return 'text-nb-600'
  }

  function formatEv(ev: number): string {
    const sign = ev >= 0 ? '+' : ''
    return `${sign}${ev.toFixed(2)}%`
  }

  function probColor(prob: number): string {
    if (prob >= 0.65) return 'text-white'
    if (prob >= 0.40) return 'text-nb-300'
    return 'text-nb-400'
  }

  function marketLabel(type: string): string {
    if (type === 'moneyline') return 'Moneyline'
    if (type === 'spread') return 'Spread'
    if (type === 'total') return 'Total'
    return type
  }

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Top EV Lines</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">
          Pre-game price vs consensus market line ·{' '}
          <span className="text-white font-medium">{positiveCount}</span> positive opportunities
          across <span className="text-white font-medium">{new Set(filtered.map(l => l.eventTitle)).size}</span> events
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* League filter */}
        <form method="GET" className="flex items-center">
          <input type="hidden" name="market" value={marketFilter} />
          <select
            name="league"
            defaultValue={leagueFilter}
            className="bg-nb-900 border border-nb-700 text-white text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-nb-500"
          >
            <option value="all">All Leagues</option>
            {leagues.map(lg => (
              <option key={lg} value={lg}>{lg}</option>
            ))}
          </select>
        </form>

        {/* Market type tabs */}
        <form method="GET" className="flex items-center gap-1.5">
          <input type="hidden" name="league" value={leagueFilter} />
          {(['all', 'moneyline', 'spread', 'total'] as const).map(m => (
            <button
              key={m}
              name="market"
              value={m}
              type="submit"
              className={[
                'text-[10px] px-3 py-1.5 rounded border transition-colors capitalize font-medium',
                marketFilter === m
                  ? 'bg-white text-nb-950 border-white'
                  : 'bg-transparent text-nb-400 border-nb-700 hover:border-nb-500 hover:text-white',
              ].join(' ')}
            >
              {m === 'all' ? 'All Types' : marketLabel(m)}
            </button>
          ))}
        </form>
      </div>

      <ProGate isPro={isPro} featureName="Top EV Lines" blur={false}>
        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nb-800">
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-20">
                      +EV %
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Event
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Market
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Best Available
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      Books
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-24">
                      Probability
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-20">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-nb-400 text-xs">
                        No lines found. Data syncs hourly — check back soon.
                      </td>
                    </tr>
                  ) : (
                    visibleLines.map((line, i) => (
                      <tr
                        key={`${line.eventId}::${line.marketType}::${line.outcomeSide}::${line.lineValue}`}
                        className={[
                          'border-b border-border/40 hover:bg-nb-800/20 transition-colors',
                          line.evPct >= 3 ? 'border-l-2 border-l-white' : '',
                        ].join(' ')}
                      >
                        {/* +EV% */}
                        <td className="px-4 py-3">
                          <span className={`font-mono text-sm font-semibold tabular-nums ${evColor(line.evPct)}`}>
                            {formatEv(line.evPct)}
                          </span>
                        </td>

                        {/* Event */}
                        <td className="px-4 py-3 min-w-[200px]">
                          <p className="text-xs font-medium text-white leading-snug">
                            {line.eventTitle}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-nb-500 font-mono">
                              {formatDateTime(line.eventStart)}
                            </span>
                            {line.leagueAbbrev !== '—' && (
                              <Badge variant="muted" className="text-[9px] py-0 px-1">
                                {line.leagueAbbrev}
                              </Badge>
                            )}
                          </div>
                        </td>

                        {/* Market / outcome */}
                        <td className="px-4 py-3">
                          <p className="text-[10px] text-nb-500 uppercase tracking-wider mb-0.5">
                            {marketLabel(line.marketType)}
                          </p>
                          <p className="text-xs text-nb-200 font-medium">
                            {line.outcomeLabel}
                          </p>
                        </td>

                        {/* Best available */}
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm text-white">
                            {formatOdds(line.bestPrice)}
                          </span>
                          <p className="text-[10px] text-nb-400 mt-0.5">{line.bestSource}</p>
                        </td>

                        {/* All books */}
                        <td className="px-4 py-3 min-w-[200px]">
                          <div className="flex flex-wrap gap-1.5">
                            {line.allSources.map((src, j) => (
                              <div
                                key={src.name}
                                className={[
                                  'flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono border',
                                  j === 0
                                    ? 'bg-nb-800 border-nb-600 text-white'
                                    : 'border-nb-800 text-nb-400',
                                ].join(' ')}
                              >
                                <span className="text-[9px] text-nb-500 font-sans">{src.name.split(' ')[0]}</span>
                                <span>{formatOdds(src.price)}</span>
                              </div>
                            ))}
                          </div>
                        </td>

                        {/* Fair probability */}
                        <td className="px-4 py-3">
                          <span className={`font-mono text-xs tabular-nums ${probColor(line.fairProb)}`}>
                            {(line.fairProb * 100).toFixed(1)}%
                          </span>
                          <p className="text-[9px] text-nb-600 mt-0.5">fair</p>
                        </td>

                        {/* Updated */}
                        <td className="px-4 py-3">
                          <span className="text-[10px] text-nb-500 font-mono whitespace-nowrap">
                            {formatRelativeTime(line.lastUpdated)}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Upgrade CTA for non-pro */}
            {!isPro && hiddenCount > 0 && (
              <div className="border-t border-nb-800 px-4 py-4 flex items-center justify-between">
                <p className="text-xs text-nb-400">
                  {hiddenCount} more lines available with Pro
                </p>
                <a
                  href="/account/billing"
                  className="text-xs font-semibold text-white bg-nb-800 hover:bg-nb-700 border border-nb-700 px-3 py-1.5 rounded transition-colors"
                >
                  Upgrade to Pro
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Informational note */}
        <p className="text-[10px] text-nb-600 leading-relaxed">
          EV % reflects how each source&apos;s price compares to the consensus no-vig market line
          computed from {'>'}2 sources. Informational only. Not financial or betting advice.
        </p>
      </ProGate>
    </div>
  )
}
