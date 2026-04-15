import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
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
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'

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

/**
 * Power devig: raises each implied probability to 1/k where k is solved so
 * the resulting probabilities sum to exactly 1. Handles lopsided moneylines
 * better than simple multiplicative normalization.
 */
function powerDevig(impliedProbs: number[]): number[] {
  let lo = 0.01, hi = 10.0
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    const sum = impliedProbs.reduce((acc, p) => acc + Math.pow(p, 1 / mid), 0)
    if (sum > 1.0) hi = mid; else lo = mid
  }
  const k = (lo + hi) / 2
  const fair = impliedProbs.map(p => Math.pow(p, 1 / k))
  const total = fair.reduce((a, b) => a + b, 0)
  return fair.map(p => p / total)
}

// Books that set their own lines — get a 2× weight bonus in consensus.
// Betfair Exchange and Pinnacle are the sharpest references globally.
const SHARP_BOOK_SLUGS = new Set([
  'pinnacle', 'betfair_ex_eu', 'betfair_ex_au', 'matchbook', 'circa',
])
// When Pinnacle is in the pool, use only Pinnacle — it's the industry reference.
const PINNACLE_SLUG = 'pinnacle'

type SnapForFair = {
  home_price: number | null
  away_price: number | null
  draw_price?: number | null
  source?: { slug?: string | null } | null
}

/**
 * Compute fair (no-vig) probabilities from a pool of book snapshots.
 *
 * Strategy:
 *   1. Pinnacle-first: if Pinnacle is present, power-devig Pinnacle alone.
 *   2. Otherwise: inverse-vig weighted consensus of all books with <10% overround,
 *      with a 2× bonus weight for known sharp books (Betfair, Circa, etc.).
 */
function computeFairProbs(
  snaps: SnapForFair[]
): { home: number; away: number; draw: number | null } | null {
  const valid = snaps.filter(s => s.home_price != null && s.away_price != null)
  if (valid.length === 0) return null

  // ── Pinnacle-first ────────────────────────────────────────────────────────
  // Pinnacle alone is sufficient — it IS the fair reference.
  const pin = valid.find(s => s.source?.slug === PINNACLE_SLUG)
  if (pin) {
    const h = americanToImpliedProb(pin.home_price!)
    const a = americanToImpliedProb(pin.away_price!)
    const d = pin.draw_price != null ? americanToImpliedProb(pin.draw_price) : null
    const fair = powerDevig(d != null ? [h, a, d] : [h, a])
    return { home: fair[0], away: fair[1], draw: d != null ? (fair[2] ?? null) : null }
  }

  // ── Weighted consensus ────────────────────────────────────────────────────
  let wH = 0, wA = 0, wD = 0, wTotal = 0, wDTotal = 0

  for (const s of valid) {
    const h = americanToImpliedProb(s.home_price!)
    const a = americanToImpliedProb(s.away_price!)
    const d = s.draw_price != null ? americanToImpliedProb(s.draw_price) : null
    const overround = h + a + (d ?? 0)

    // Skip price-follower books (high vig = copying others)
    if (overround > 1.10) continue

    const fair = powerDevig(d != null ? [h, a, d] : [h, a])
    const slug = s.source?.slug ?? ''
    const sharpBonus = SHARP_BOOK_SLUGS.has(slug) ? 2.0 : 1.0
    const w = (1 / overround) * sharpBonus

    wH += w * fair[0]
    wA += w * fair[1]
    wTotal += w
    if (d != null) { wD += w * (fair[2] ?? 0); wDTotal += w }
  }

  if (wTotal === 0) return null

  return {
    home: wH / wTotal,
    away: wA / wTotal,
    draw: wDTotal >= 2 ? wD / wDTotal : null,
  }
}

function computeEv(fairProb: number, americanOdds: number): number {
  return (fairProb * americanToDecimal(americanOdds) - 1) * 100
}

/** Kelly criterion: optimal fraction of bankroll to bet */
function kellyFraction(fairProb: number, americanOdds: number): number {
  const decOdds = americanToDecimal(americanOdds)
  const b = decOdds - 1 // net odds (profit per $1 bet)
  const q = 1 - fairProb
  const kelly = (b * fairProb - q) / b
  // Quarter Kelly for safety (full Kelly is too aggressive)
  return Math.max(0, kelly * 0.25)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceOdds { name: string; price: number; evPct: number }

interface EvLine {
  eventTitle: string
  eventStart: string
  leagueAbbrev: string
  marketType: string
  outcomeSide: 'home' | 'away' | 'draw' | 'over'
  outcomeLabel: string
  lineValue: number | null
  bestPrice: number
  bestSource: string
  evPct: number
  fairProb: number
  kellyPct: number            // quarter-Kelly recommended stake %
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

  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const { data: snapshots } = await supabase
    .from('current_market_odds')
    .select(`
      id, event_id, source_id, market_type,
      home_price, away_price, draw_price,
      spread_value, total_value, over_price, under_price, snapshot_time,
      event:events(id, title, start_time, league:leagues(name, abbreviation, slug)),
      source:market_sources(id, name, slug)
    `)
    .gt('snapshot_time', cutoff)
    .in('market_type', ['moneyline', 'spread', 'total'])
    .limit(10000)

  // ── Dedup + Group by (event_id, market_type) ────────────────────────────
  // Keep only the LATEST row per (event_id, source_id, market_type) to prevent
  // duplicate Pinnacle/book entries from stale or alternate-line rows.

  type Snap = NonNullable<typeof snapshots>[number]

  // Step 1: Dedup — keep latest per (event, source, market_type)
  const dedupKey = (s: Snap) => `${s.event_id}|${s.source_id}|${s.market_type}`
  const latestByKey = new Map<string, Snap>()
  for (const snap of snapshots ?? []) {
    const key = dedupKey(snap)
    const existing = latestByKey.get(key)
    if (!existing || snap.snapshot_time > existing.snapshot_time) {
      latestByKey.set(key, snap)
    }
  }

  // Step 2: Group deduped snaps by (event_id, market_type)
  const groupMap = new Map<string, Snap[]>()
  for (const snap of latestByKey.values()) {
    const sourceSlug: string = (snap as any).source?.slug ?? ''
    if (sourceSlug === 'polymarket') continue
    if (enabledBooks && !enabledBooks.has(sourceSlug)) continue
    const ev = (snap as any).event
    if (!ev) continue
    if (!isUpcomingEvent(ev.start_time)) continue

    const key = `${snap.event_id}::${snap.market_type}`
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

    // For totals, map over_price→home_price and under_price→away_price
    // so the fair prob computation works (it expects home/away)
    const fair = computeFairProbs(
      snaps.map(s => ({
        home_price: marketType === 'total' ? ((s as any).over_price ?? s.home_price) : s.home_price,
        away_price: marketType === 'total' ? ((s as any).under_price ?? s.away_price) : s.away_price,
        draw_price: s.draw_price,
        source: (s as any).source,
      }))
    )
    if (!fair) continue

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

      // Best available = highest EV from a NON-sharp book (Pinnacle is the reference, not a bet)
      const bettableSources = allSources.filter(s => s.name !== 'Pinnacle')
      if (bettableSources.length === 0) return
      const best = bettableSources[0]
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
        kellyPct: kellyFraction(fairProb, best.price) * 100,
        allSources,
        lastUpdated,
        shape,
      })
    }

    // Require Pinnacle in the group for reliable fair probs.
    // Without Pinnacle, consensus of soft books (many are Kambi copies) is unreliable.
    const hasPinnacle = snaps.some(s => (s as any).source?.slug === PINNACLE_SLUG)
    if (!hasPinnacle) continue

    if (marketType === 'moneyline') {
      buildLine('home', homeTeam, s => s.home_price, fair.home)
      // Only show draw EV when Pinnacle has a draw price (reliable 3-way fair prob)
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
      buildLine('over', `Over ${totalVal}`, s => (s as any).over_price ?? s.home_price, fair.home)
      buildLine('away', `Under ${totalVal}`, s => (s as any).under_price ?? s.away_price, fair.away)
    }
  }

  // ── Prop +EV Detection ──────────────────────────────────────────────────
  // Query prop_odds, group by (event, category, player, line), compute fair prob
  // from sharpest book (most balanced O/U), then find +EV across all books.
  const propCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { data: propOddsRaw } = await supabase
    .from('prop_odds')
    .select(`
      event_id, source_id, prop_category, player_name, line_value,
      over_price, under_price, snapshot_time,
      event:events(id, title, start_time, league:leagues(abbreviation)),
      source:market_sources(id, name, slug)
    `)
    .gt('snapshot_time', propCutoff)
    .not('over_price', 'is', null)
    .not('under_price', 'is', null)
    .limit(5000)

  if (propOddsRaw && propOddsRaw.length > 0) {
    // Filter by enabled books + upcoming events
    const filteredProps = (propOddsRaw as any[]).filter(p => {
      const slug = p.source?.slug ?? ''
      if (enabledBooks && !enabledBooks.has(slug)) return false
      if (!p.event || !isUpcomingEvent(p.event.start_time)) return false
      return true
    })

    // Group by (event_id, prop_category, player_name, line_value)
    const propGroups = new Map<string, any[]>()
    for (const p of filteredProps) {
      const key = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}`
      if (!propGroups.has(key)) propGroups.set(key, [])
      propGroups.get(key)!.push(p)
    }

    for (const group of propGroups.values()) {
      if (group.length < 2) continue // need 2+ books to compute fair

      // Compute fair prob: power-devig the most balanced book (closest to -110/-110)
      let bestBalance = Infinity
      let fairOver = 0.5
      let fairUnder = 0.5

      for (const p of group) {
        const overProb = americanToImpliedProb(p.over_price)
        const underProb = americanToImpliedProb(p.under_price)
        const balance = Math.abs(overProb - underProb)
        if (balance < bestBalance) {
          bestBalance = balance
          const devigged = powerDevig([overProb, underProb])
          fairOver = devigged[0]
          fairUnder = devigged[1]
        }
      }

      const ev = group[0].event
      const leagueAbbrev = ev?.league?.abbreviation ?? '—'
      const propCat = group[0].prop_category as string
      const playerName = group[0].player_name as string
      const lineVal = group[0].line_value

      const PROP_LABELS: Record<string, string> = {
        player_points: 'Pts', player_rebounds: 'Reb', player_assists: 'Ast',
        player_threes: '3PM', player_pts_reb_ast: 'PRA',
      }
      const catLabel = PROP_LABELS[propCat] ?? propCat.replace('player_', '')

      // Check each book's over and under for +EV
      for (const side of ['over', 'under'] as const) {
        const fairProb = side === 'over' ? fairOver : fairUnder
        const getPrice = (p: any) => side === 'over' ? p.over_price : p.under_price

        const allSources: SourceOdds[] = group.map(p => ({
          name: p.source?.name ?? '?',
          price: getPrice(p),
          evPct: computeEv(fairProb, getPrice(p)),
        }))
        allSources.sort((a, b) => b.evPct - a.evPct)

        const best = allSources[0]
        if (best.evPct > 0) {
          evLines.push({
            eventId: group[0].event_id,
            eventTitle: ev?.title ?? '—',
            eventStart: ev?.start_time ?? '',
            leagueAbbrev,
            marketType: 'prop',
            outcomeSide: side === 'over' ? 'home' : 'away',
            outcomeLabel: `${playerName} ${catLabel} ${side === 'over' ? 'O' : 'U'} ${lineVal ?? ''}`,
            lineValue: lineVal,
            bestPrice: best.price,
            bestSource: best.name,
            evPct: best.evPct,
            fairProb,
            kellyPct: kellyFraction(fairProb, best.price) * 100,
            allSources,
            lastUpdated: group.reduce((max: string, p: any) => p.snapshot_time > max ? p.snapshot_time : max, group[0].snapshot_time),
            shape: '2way' as MarketShape,
          })
        }
      }
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
    if (type === 'prop') return 'Prop'
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
          {(['all', 'moneyline', 'spread', 'total', 'prop'] as const).map(m => (
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

        {/* ── Top 3 Podium ─────────────────────────────────────────────────── */}
        {visibleLines.length >= 1 && (() => {
          const top = visibleLines.slice(0, 3)
          const gold   = top[0]
          const silver = top[1] ?? null
          const bronze = top[2] ?? null

          const medals = [
            { line: silver, rank: 2, label: '2nd', color: 'from-slate-500/20 to-slate-600/10', border: 'border-slate-500/40', badge: 'bg-slate-600/60 text-slate-200', podiumH: 'h-16', emoji: '🥈' },
            { line: gold,   rank: 1, label: '1st', color: 'from-amber-500/20 to-amber-600/10', border: 'border-amber-400/50', badge: 'bg-amber-500/70 text-amber-100', podiumH: 'h-24', emoji: '🥇' },
            { line: bronze, rank: 3, label: '3rd', color: 'from-orange-700/20 to-orange-800/10', border: 'border-orange-600/40', badge: 'bg-orange-700/60 text-orange-200', podiumH: 'h-10', emoji: '🥉' },
          ]

          return (
            <div className="mb-5">
              <div className="flex items-end gap-3">
                {medals.map(({ line, rank, label, color, border, badge, podiumH, emoji }) => {
                  if (!line) return <div key={rank} className="flex-1" />
                  return (
                    <div key={rank} className="flex-1 flex flex-col">
                      {/* Card */}
                      <div className={`rounded-xl border bg-gradient-to-b ${color} ${border} p-4 relative`}>
                        {/* Medal badge */}
                        <span className={`absolute top-3 right-3 text-[10px] font-bold px-1.5 py-0.5 rounded ${badge}`}>
                          {emoji} {label}
                        </span>

                        <p className="text-[10px] text-nb-500 uppercase tracking-wider mb-1">
                          {marketLabel(line.marketType)}
                          {line.leagueAbbrev !== '—' && (
                            <span className="ml-1.5 text-nb-600">· {line.leagueAbbrev}</span>
                          )}
                        </p>
                        <p className="text-xs font-medium text-nb-300 leading-snug mb-2 pr-10" title={line.eventTitle}>
                          {line.eventTitle.length > 40 ? line.eventTitle.slice(0, 38) + '…' : line.eventTitle}
                        </p>
                        <p className="text-sm font-semibold text-white mb-0.5">{line.outcomeLabel}</p>
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-xl font-bold text-white">{formatOdds(line.bestPrice)}</span>
                          <span className="text-[10px] text-nb-400">{line.bestSource}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className={`font-mono text-xs font-bold ${evColor(line.evPct)}`}>
                            {formatEv(line.evPct)}
                          </span>
                          <span className="text-[10px] text-nb-500">
                            Fair: <span className={`font-mono ${probColor(line.fairProb)}`}>{(line.fairProb * 100).toFixed(1)}%</span>
                          </span>
                        </div>
                      </div>
                      {/* Podium step */}
                      <div className={`${podiumH} rounded-b-lg mt-0 ${
                        rank === 1 ? 'bg-amber-500/15 border-x border-b border-amber-400/30'
                        : rank === 2 ? 'bg-slate-500/10 border-x border-b border-slate-500/25'
                        : 'bg-orange-700/10 border-x border-b border-orange-600/25'
                      }`} />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nb-800">
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
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-20">
                      EV %
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-24">
                      Probability
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-20">
                      Kelly
                    </th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-20">
                      Updated
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.length <= 3 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-nb-400 text-xs">
                        No additional lines found. Data syncs hourly — check back soon.
                      </td>
                    </tr>
                  ) : (
                    visibleLines.slice(3).map((line, i) => (
                      <tr
                        key={`${line.eventId}::${line.marketType}::${line.outcomeSide}::${line.lineValue}`}
                        className={[
                          'border-b border-border/40 hover:bg-nb-800/20 transition-colors',
                        ].join(' ')}
                      >
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

                        {/* EV % */}
                        <td className="px-4 py-3">
                          <span className={`font-mono text-xs tabular-nums font-semibold ${evColor(line.evPct)}`}>
                            {formatEv(line.evPct)}
                          </span>
                        </td>

                        {/* Fair probability */}
                        <td className="px-4 py-3">
                          <span className={`font-mono text-xs tabular-nums ${probColor(line.fairProb)}`}>
                            {(line.fairProb * 100).toFixed(1)}%
                          </span>
                          <p className="text-[9px] text-nb-600 mt-0.5">fair</p>
                        </td>

                        {/* Kelly % */}
                        <td className="px-4 py-3">
                          {line.kellyPct > 0 ? (
                            <span className={`font-mono text-xs tabular-nums ${
                              line.kellyPct >= 2 ? 'text-green-400 font-semibold' :
                              line.kellyPct >= 0.5 ? 'text-nb-300' : 'text-nb-500'
                            }`}>
                              {line.kellyPct.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-nb-700 text-xs">—</span>
                          )}
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
          EV % reflects how each source&apos;s price compares to the fair probability derived via
          power devig — Pinnacle when available, otherwise inverse-vig weighted consensus.
          Informational only. Not financial or betting advice.
        </p>
      </ProGate>
    </div>
  )
}
