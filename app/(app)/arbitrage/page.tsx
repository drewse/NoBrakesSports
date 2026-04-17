import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { ProGate } from '@/components/shared/pro-gate'
import {
  americanToImpliedProb,
  getMarketShape,
  calcCombinedProb,
  type MarketShape,
} from '@/lib/utils'
import { isUpcomingEvent } from '@/lib/queries'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import type { PropArb } from '@/components/arbitrage/prop-arb-table'
import { ArbCalculatorClient, type UnifiedArb } from './arb-calculator-client'

export const metadata = { title: 'Arbitrage' }

// Sport slugs that use 3-way moneyline (home/draw/away)
const THREE_WAY_SPORT_SLUGS = new Set(['soccer'])

export default async function ArbitragePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()
  const isPro =
    profile?.subscription_tier === 'pro' &&
    profile?.subscription_status === 'active'

  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)

  // Query current_market_odds — one row per (event, source, market_type).
  // This table has ~500 rows total vs market_snapshots which grows unboundedly.
  // Filter stale odds: snapshot_time within last 4 hours (adapters run every ~15 min).
  const staleCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: snapshots } = await supabase
    .from('current_market_odds')
    .select(
      `
      event_id, source_id, market_type, home_price, away_price, draw_price, snapshot_time,
      event:events(id, title, start_time, status, league:leagues(name, abbreviation, slug, sport:sports(slug))),
      source:market_sources(id, name, slug)
    `
    )
    .eq('market_type', 'moneyline')
    .gt('snapshot_time', staleCutoff)
    .limit(5000)

  // Filter out Polymarket and apply user's book selection
  const filteredSnapshots = (snapshots ?? []).filter(s => {
    const slug: string = (s as any).source?.slug ?? ''
    if (slug === 'polymarket') return false
    if (enabledBooks && !enabledBooks.has(slug)) return false
    return true
  })

  // Group snapshots by event_id — skip events without embedded event data
  const byEvent = new Map<string, (typeof snapshots extends (infer T)[] | null ? T : never)[]>()
  for (const snap of filteredSnapshots) {
    const ev = (snap as any).event
    if (!ev) continue
    if (!byEvent.has(snap.event_id)) byEvent.set(snap.event_id, [])
    byEvent.get(snap.event_id)!.push(snap as any)
  }

  const arbs: {
    eventTitle: string
    league: string
    shape: MarketShape
    bestHomePrice: number
    bestHomeSource: string
    bestDrawPrice: number | null
    bestDrawSource: string | null
    bestAwayPrice: number
    bestAwaySource: string
    homeProb: number
    drawProb: number | null
    awayProb: number
    combinedProb: number
    profitPct: number
    lastUpdated: string
  }[] = []

  for (const snapsRaw of byEvent.values()) {
    // current_market_odds already has exactly one row per (event, source, market_type)
    // so no dedup needed — but we keep the pass-through for type consistency.
    const snaps = snapsRaw

    const event = (snaps[0] as any).event
    // Pre-game only: skip events that have already started
    if (!isUpcomingEvent(event?.start_time)) continue
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string = event?.league?.slug ?? ''
    const sportSlug: string = event?.league?.sport?.slug ?? ''

    // Use sport-level detection: all soccer = 3-way moneyline
    const shape: MarketShape = THREE_WAY_SPORT_SLUGS.has(sportSlug)
      ? '3way'
      : getMarketShape(leagueSlug || null, sportSlug || null, 'moneyline')

    // Filter out snapshots that are likely 1X2 (regulation 3-way) odds
    // masquerading as 2-way moneyline. In a real 2-way market, a single book's
    // home + away implied probs sum to ~1.02–1.10. If the sum is below 0.85,
    // the book is almost certainly sending 3-way odds without a draw column
    // (e.g. 1xBet's 1X2 market), which creates phantom arbitrage.
    const MIN_TWO_WAY_TOTAL = 0.85
    const validSnaps =
      shape === '2way'
        ? snaps.filter((s: any) => {
            if (s.home_price == null || s.away_price == null) return true
            const total =
              americanToImpliedProb(s.home_price) +
              americanToImpliedProb(s.away_price)
            return total >= MIN_TWO_WAY_TOTAL
          })
        : snaps

    const withHome = validSnaps.filter((s: any) => s.home_price != null)
    const withAway = validSnaps.filter((s: any) => s.away_price != null)
    const withDraw = validSnaps.filter((s: any) => s.draw_price != null)

    // Need at least 2 books for home and away to have an arb
    if (withHome.length < 2 || withAway.length < 2) continue

    // For 3-way markets, require draw data from at least one book
    if (shape === '3way' && withDraw.length === 0) continue

    const bestHome = withHome.reduce((b: any, s: any) =>
      s.home_price! > b.home_price! ? s : b
    )
    const bestAway = withAway.reduce((b: any, s: any) =>
      s.away_price! > b.away_price! ? s : b
    )
    const bestDrawSnap =
      withDraw.length > 0
        ? withDraw.reduce((b: any, s: any) =>
            s.draw_price! > b.draw_price! ? s : b
          )
        : null

    // For 3-way, we need a draw price to compute a valid arb
    if (shape === '3way' && bestDrawSnap == null) continue

    // Final guard: home and away must come from different books
    if ((bestHome as any).source_id === (bestAway as any).source_id) continue

    const homeProb = americanToImpliedProb(bestHome.home_price!)
    const awayProb = americanToImpliedProb(bestAway.away_price!)
    const drawProb =
      bestDrawSnap != null
        ? americanToImpliedProb(bestDrawSnap.draw_price!)
        : null

    const combinedProb = calcCombinedProb(shape, homeProb, drawProb, awayProb)

    // Always include — even negative arbs are useful for the feed
    // (shows closest-to-arb opportunities when no true arbs exist)
    const profitPct = (1 / combinedProb - 1) * 100
    arbs.push({
      eventTitle: event?.title ?? '—',
      league: leagueAbbrev || '—',
      shape,
      bestHomePrice: bestHome.home_price!,
      bestHomeSource: (bestHome as any).source?.name ?? '—',
      bestDrawPrice: bestDrawSnap?.draw_price ?? null,
      bestDrawSource: bestDrawSnap != null ? ((bestDrawSnap as any).source?.name ?? '—') : null,
      bestAwayPrice: bestAway.away_price!,
      bestAwaySource: (bestAway as any).source?.name ?? '—',
      homeProb,
      drawProb,
      awayProb,
      combinedProb,
      profitPct,
      lastUpdated: snaps.reduce(
        (max: string, s: any) =>
          s.snapshot_time > max ? s.snapshot_time : max,
        snaps[0].snapshot_time
      ),
    })
  }

  arbs.sort((a, b) => b.profitPct - a.profitPct)

  const uniqueBooks = new Set([
    ...arbs.map((a) => a.bestHomeSource),
    ...arbs.map((a) => a.bestAwaySource),
  ]).size

  // ── Prop Arb Detection ────────────────────────────────────────────────────
  const propArbs: PropArb[] = []

  const propStaleCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() // 4 hours, same as game-level
  // Fetch props in batches — Supabase PostgREST returns max 1000 rows per request.
  // With 12 books × all sports × all categories, total can exceed 6000+.
  const PROP_PAGE = 1000
  let propOddsRaw: any[] = []
  for (let offset = 0; offset < 20000; offset += PROP_PAGE) {
    const { data: batch } = await supabase
      .from('prop_odds')
      .select(`
        event_id, source_id, prop_category, player_name, line_value,
        over_price, under_price, over_implied_prob, under_implied_prob, snapshot_time,
        event:events(id, title, start_time, league:leagues(abbreviation)),
        source:market_sources(id, name, slug)
      `)
      .gt('snapshot_time', propStaleCutoff)
      .or('over_price.not.is.null,under_price.not.is.null')
      .range(offset, offset + PROP_PAGE - 1)
    if (!batch || batch.length === 0) break
    propOddsRaw.push(...batch)
  }

  if (propOddsRaw && propOddsRaw.length > 0) {
    // Filter by enabled books
    const filteredProps = propOddsRaw.filter((p: any) => {
      const slug = p.source?.slug ?? ''
      if (enabledBooks && !enabledBooks.has(slug)) return false
      return true
    })

    // Group by (event_id, prop_category, player_name, line_value)
    const propGroups = new Map<string, any[]>()
    for (const p of filteredProps) {
      if (!(p as any).event || !isUpcomingEvent((p as any).event?.start_time)) continue
      const key = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}`
      if (!propGroups.has(key)) propGroups.set(key, [])
      propGroups.get(key)!.push(p)
    }

    // Find arbs: best over from one book vs best under from another
    for (const group of propGroups.values()) {
      if (group.length < 2) continue // need 2+ books

      const bestOver = group.reduce((best: any, p: any) =>
        (p.over_price ?? -Infinity) > (best.over_price ?? -Infinity) ? p : best
      )
      const bestUnder = group.reduce((best: any, p: any) =>
        (p.under_price ?? -Infinity) > (best.under_price ?? -Infinity) ? p : best
      )

      // Must come from different books
      if (bestOver.source_id === bestUnder.source_id) continue

      const overProb = americanToImpliedProb(bestOver.over_price)
      const underProb = americanToImpliedProb(bestUnder.under_price)
      const combinedProb = overProb + underProb

      const profitPct = (1 / combinedProb - 1) * 100
      const ev = (bestOver as any).event
      propArbs.push({
        eventTitle: ev?.title ?? '—',
        league: ev?.league?.abbreviation ?? '—',
        propCategory: bestOver.prop_category,
        playerName: bestOver.player_name,
        lineValue: bestOver.line_value,
        bestOverPrice: bestOver.over_price,
        bestOverSource: (bestOver as any).source?.name ?? '—',
        bestUnderPrice: bestUnder.under_price,
        bestUnderSource: (bestUnder as any).source?.name ?? '—',
        overProb,
        underProb,
        combinedProb,
        profitPct,
        lastUpdated: group.reduce(
          (max: string, p: any) => p.snapshot_time > max ? p.snapshot_time : max,
          group[0].snapshot_time,
        ),
      })
    }

    propArbs.sort((a, b) => b.profitPct - a.profitPct)
  }

  // Merge game + prop arbs into one unified list sorted by profit %
  const allArbs: UnifiedArb[] = []

  for (const arb of arbs) {
    allArbs.push({
      type: 'game',
      eventTitle: arb.eventTitle,
      league: arb.league,
      description: arb.shape === '3way' ? 'Moneyline 3W' : 'Moneyline',
      bestSideA: { label: 'Home', price: arb.bestHomePrice, source: arb.bestHomeSource },
      bestSideB: { label: 'Away', price: arb.bestAwayPrice, source: arb.bestAwaySource },
      bestDraw: arb.bestDrawPrice != null ? { price: arb.bestDrawPrice, source: arb.bestDrawSource ?? '—' } : null,
      combinedProb: arb.combinedProb,
      profitPct: arb.profitPct,
      lastUpdated: arb.lastUpdated,
    })
  }

  for (const arb of propArbs) {
    allArbs.push({
      type: 'prop',
      eventTitle: arb.eventTitle,
      league: arb.league,
      description: `${arb.playerName} ${formatPropCat(arb.propCategory)}${arb.lineValue != null ? ` ${arb.lineValue}` : ''}`,
      bestSideA: { label: 'Over', price: arb.bestOverPrice, source: arb.bestOverSource },
      bestSideB: { label: 'Under', price: arb.bestUnderPrice, source: arb.bestUnderSource },
      bestDraw: null,
      combinedProb: arb.combinedProb,
      profitPct: arb.profitPct,
      lastUpdated: arb.lastUpdated,
    })
  }

  allArbs.sort((a, b) => b.profitPct - a.profitPct)
  const totalArbs = allArbs.length

  function formatPropCat(cat: string): string {
    const labels: Record<string, string> = {
      // Basketball
      player_points: 'Pts', player_rebounds: 'Reb', player_assists: 'Ast',
      player_threes: '3PM', player_pts_reb_ast: 'PRA', player_steals: 'Stl',
      player_blocks: 'Blk', player_turnovers: 'TO',
      player_pts_reb: 'P+R', player_pts_ast: 'P+A', player_ast_reb: 'R+A',
      player_double_double: 'DD', player_triple_double: 'TD',
      // Baseball
      player_hits: 'Hits', player_home_runs: 'HR', player_rbis: 'RBI',
      player_strikeouts_p: 'K', player_earned_runs: 'ER', player_total_bases: 'TB',
      player_runs: 'Runs', player_stolen_bases: 'SB', player_walks: 'BB',
      player_hits_allowed: 'HA', pitcher_outs: 'Outs',
      // Hockey
      player_goals: 'Goals', player_hockey_assists: 'Ast', player_hockey_points: 'Pts',
      player_shots_on_goal: 'SOG', player_saves: 'Saves', player_power_play_pts: 'PPP',
      // Soccer
      player_soccer_goals: 'Goals', player_shots_target: 'SOT',
      anytime_scorer: 'AGS', anytime_goal_scorer: 'AGS',
    }
    return labels[cat] ?? cat.replace(/^player_/, '')
  }

  return (
    <div className="p-6 space-y-5 max-w-[1600px]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Arbitrage</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">
          {totalArbs} opportunities detected across {uniqueBooks} books
        </p>
      </div>

      <ProGate isPro={isPro} featureName="Arbitrage" blur={false}>
        <ArbCalculatorClient
          arbs={allArbs as UnifiedArb[]}
          totalArbs={totalArbs}
          uniqueBooks={uniqueBooks}
        />
      </ProGate>
    </div>
  )
}
