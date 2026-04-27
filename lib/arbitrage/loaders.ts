// Server-side loader for /arbitrage. Used by both the SSR page and the
// /api/arbitrage live-polling endpoint. Returns JSON-serializable arbs.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  americanToImpliedProb,
  getMarketShape,
  calcCombinedProb,
  type MarketShape,
} from '@/lib/utils'
import { isUpcomingEvent } from '@/lib/queries'

const THREE_WAY_SPORT_SLUGS = new Set(['soccer'])

export type UnifiedArb = {
  /** Stable identity for diffing across polls: type + event + outcome + book pair. */
  id: string
  type: 'game' | 'prop'
  eventTitle: string
  league: string
  description: string
  bestSideA: { label: string; price: number; source: string }
  bestSideB: { label: string; price: number; source: string }
  bestDraw?: { price: number; source: string } | null
  combinedProb: number
  profitPct: number
  lastUpdated: string
}

export interface ArbsResult {
  arbs: UnifiedArb[]
  totalArbs: number
  uniqueBooks: number
}

const FRESHNESS_MS = 5 * 60 * 1000
const PROP_PAGE = 1000
const TOP_N = 50

function formatPropCat(cat: string): string {
  const labels: Record<string, string> = {
    player_points: 'Pts', player_rebounds: 'Reb', player_assists: 'Ast',
    player_threes: '3PM', player_pts_reb_ast: 'PRA', player_steals: 'Stl',
    player_blocks: 'Blk', player_turnovers: 'TO', player_steals_blocks: 'Stl+Blk',
    player_pts_reb: 'P+R', player_pts_ast: 'P+A', player_ast_reb: 'R+A',
    player_double_double: 'DD', player_triple_double: 'TD',
    game_total_hits: 'Game Hits',
    player_hits: 'Hits', player_home_runs: 'HR', player_rbis: 'RBI',
    player_strikeouts_p: 'K', player_earned_runs: 'ER', player_total_bases: 'TB',
    player_runs: 'Runs', player_stolen_bases: 'SB', player_walks: 'BB',
    player_hits_allowed: 'HA', pitcher_outs: 'Outs',
    player_goals: 'Goals', player_hockey_assists: 'Ast', player_hockey_points: 'Pts',
    player_shots_on_goal: 'SOG', player_saves: 'Saves', player_power_play_pts: 'PPP',
    player_soccer_goals: 'Goals', player_shots_target: 'SOT',
    anytime_scorer: 'AGS', anytime_goal_scorer: 'AGS',
  }
  return labels[cat] ?? cat.replace(/^player_/, '')
}

export async function loadArbs(
  supabase: SupabaseClient,
  enabledBooks: Set<string> | null,
): Promise<ArbsResult> {
  const staleCutoff = new Date(Date.now() - FRESHNESS_MS).toISOString()
  const snapshotsPromise = supabase
    .from('current_market_odds')
    .select(`
      event_id, source_id, market_type, home_price, away_price, draw_price, snapshot_time,
      event:events(id, title, start_time, status, league:leagues(name, abbreviation, slug, sport:sports(slug))),
      source:market_sources(id, name, slug)
    `)
    .eq('market_type', 'moneyline')
    .gt('snapshot_time', staleCutoff)
    .limit(5000)

  const propStaleCutoff = new Date(Date.now() - FRESHNESS_MS).toISOString()
  const fetchAllProps = async (): Promise<any[]> => {
    const { count } = await supabase
      .from('prop_odds')
      .select('id', { count: 'exact', head: true })
      .gt('snapshot_time', propStaleCutoff)
      .or('over_price.not.is.null,under_price.not.is.null')
    const total = count ?? 0
    if (total === 0) return []
    const pageCount = Math.ceil(total / PROP_PAGE)
    const batches = await Promise.all(
      Array.from({ length: pageCount }, (_, i) =>
        supabase
          .from('prop_odds')
          .select(`
            event_id, source_id, prop_category, player_name, line_value,
            over_price, under_price, over_implied_prob, under_implied_prob, snapshot_time,
            event:events(id, title, start_time, league:leagues(abbreviation)),
            source:market_sources(id, name, slug)
          `)
          .gt('snapshot_time', propStaleCutoff)
          .or('over_price.not.is.null,under_price.not.is.null')
          .range(i * PROP_PAGE, (i + 1) * PROP_PAGE - 1),
      ),
    )
    const all: any[] = []
    for (const { data } of batches) if (data) all.push(...data)
    return all
  }
  const propBatchPromises = fetchAllProps()

  const { data: snapshots } = await snapshotsPromise

  const filteredSnapshots = (snapshots ?? []).filter(s => {
    const slug: string = (s as any).source?.slug ?? ''
    if (slug === 'polymarket') return false
    if (enabledBooks && !enabledBooks.has(slug)) return false
    return true
  })

  const byEvent = new Map<string, any[]>()
  for (const snap of filteredSnapshots) {
    const ev = (snap as any).event
    if (!ev) continue
    if (!byEvent.has(snap.event_id)) byEvent.set(snap.event_id, [])
    byEvent.get(snap.event_id)!.push(snap)
  }

  const gameArbs: Array<{
    eventId: string
    eventTitle: string
    league: string
    shape: MarketShape
    bestHomePrice: number
    bestHomeSource: string
    bestDrawPrice: number | null
    bestDrawSource: string | null
    bestAwayPrice: number
    bestAwaySource: string
    combinedProb: number
    profitPct: number
    lastUpdated: string
  }> = []

  for (const snaps of byEvent.values()) {
    const event = (snaps[0] as any).event
    if (!isUpcomingEvent(event?.start_time)) continue
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string = event?.league?.slug ?? ''
    const sportSlug: string = event?.league?.sport?.slug ?? ''
    const shape: MarketShape = THREE_WAY_SPORT_SLUGS.has(sportSlug)
      ? '3way'
      : getMarketShape(leagueSlug || null, sportSlug || null, 'moneyline')

    // Filter 1X2-as-2way snapshots that produce phantom arbs
    const MIN_TWO_WAY_TOTAL = 0.85
    const validSnaps = shape === '2way'
      ? snaps.filter((s: any) => {
          if (s.home_price == null || s.away_price == null) return true
          const total = americanToImpliedProb(s.home_price) + americanToImpliedProb(s.away_price)
          return total >= MIN_TWO_WAY_TOTAL
        })
      : snaps

    const withHome = validSnaps.filter((s: any) => s.home_price != null)
    const withAway = validSnaps.filter((s: any) => s.away_price != null)
    const withDraw = validSnaps.filter((s: any) => s.draw_price != null)
    if (withHome.length < 2 || withAway.length < 2) continue
    if (shape === '3way' && withDraw.length === 0) continue

    const homeBySource = new Map<string, any>()
    for (const s of withHome) {
      const ex = homeBySource.get(s.source_id)
      if (!ex || s.home_price! > ex.home_price!) homeBySource.set(s.source_id, s)
    }
    const awayBySource = new Map<string, any>()
    for (const s of withAway) {
      const ex = awayBySource.get(s.source_id)
      if (!ex || s.away_price! > ex.away_price!) awayBySource.set(s.source_id, s)
    }
    const bestDrawSnap = withDraw.length > 0
      ? withDraw.reduce((b: any, s: any) => (s.draw_price! > b.draw_price! ? s : b))
      : null
    if (shape === '3way' && bestDrawSnap == null) continue

    const lastUpdated = snaps.reduce(
      (max: string, s: any) => (s.snapshot_time > max ? s.snapshot_time : max),
      snaps[0].snapshot_time,
    )
    const pairSeen = new Set<string>()

    for (const homeSnap of homeBySource.values()) {
      for (const awaySnap of awayBySource.values()) {
        if ((homeSnap as any).source_id === (awaySnap as any).source_id) continue
        const homeProb = americanToImpliedProb(homeSnap.home_price!)
        const awayProb = americanToImpliedProb(awaySnap.away_price!)
        const drawProb = bestDrawSnap != null
          ? americanToImpliedProb(bestDrawSnap.draw_price!)
          : null
        const combinedProb = calcCombinedProb(shape, homeProb, drawProb, awayProb)
        const profitPct = (1 / combinedProb - 1) * 100
        if (profitPct <= 0) continue

        const pairKey = `${(homeSnap as any).source_id}|${(awaySnap as any).source_id}`
        if (pairSeen.has(pairKey)) continue
        pairSeen.add(pairKey)

        gameArbs.push({
          eventId: event?.id ?? '',
          eventTitle: event?.title ?? '—',
          league: leagueAbbrev || '—',
          shape,
          bestHomePrice: homeSnap.home_price!,
          bestHomeSource: (homeSnap as any).source?.name ?? '—',
          bestDrawPrice: bestDrawSnap?.draw_price ?? null,
          bestDrawSource: bestDrawSnap != null ? ((bestDrawSnap as any).source?.name ?? '—') : null,
          bestAwayPrice: awaySnap.away_price!,
          bestAwaySource: (awaySnap as any).source?.name ?? '—',
          combinedProb,
          profitPct,
          lastUpdated,
        })
      }
    }
  }

  // ── Prop arbs ─────────────────────────────────────────────────────────────
  const propArbs: Array<{
    eventId: string
    eventTitle: string
    league: string
    propCategory: string
    playerName: string
    lineValue: number
    bestOverPrice: number
    bestOverSource: string
    bestUnderPrice: number
    bestUnderSource: string
    combinedProb: number
    profitPct: number
    lastUpdated: string
  }> = []

  const propOddsRaw: any[] = await propBatchPromises
  if (propOddsRaw && propOddsRaw.length > 0) {
    const filteredProps = propOddsRaw.filter((p: any) => {
      const slug = p.source?.slug ?? ''
      if (enabledBooks && !enabledBooks.has(slug)) return false
      return true
    })
    // Dedupe by (event, category, player, line, source) keeping the most-
    // recent snapshot — same fix as the +EV loader. Without this the
    // bestOverBySource / bestUnderBySource maps just collapse the noise
    // away, but it's still wasted work and the upstream group loses
    // determinism if a book has stale rows.
    const latestPropBySrc = new Map<string, any>()
    for (const p of filteredProps) {
      if (!(p as any).event || !isUpcomingEvent((p as any).event?.start_time)) continue
      const k = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}|${p.source_id}`
      const existing = latestPropBySrc.get(k)
      if (!existing || p.snapshot_time > existing.snapshot_time) {
        latestPropBySrc.set(k, p)
      }
    }
    const propGroups = new Map<string, any[]>()
    for (const p of latestPropBySrc.values()) {
      const key = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}`
      if (!propGroups.has(key)) propGroups.set(key, [])
      propGroups.get(key)!.push(p)
    }
    for (const group of propGroups.values()) {
      if (group.length < 2) continue
      const withOver = group.filter((p: any) => p.over_price != null)
      const withUnder = group.filter((p: any) => p.under_price != null)
      if (withOver.length === 0 || withUnder.length === 0) continue

      const bestOverBySource = new Map<string, any>()
      for (const p of withOver) {
        const existing = bestOverBySource.get(p.source_id)
        if (!existing || p.over_price > existing.over_price) bestOverBySource.set(p.source_id, p)
      }
      const bestUnderBySource = new Map<string, any>()
      for (const p of withUnder) {
        const existing = bestUnderBySource.get(p.source_id)
        if (!existing || p.under_price > existing.under_price) bestUnderBySource.set(p.source_id, p)
      }

      const latestUpdated = group.reduce(
        (max: string, p: any) => (p.snapshot_time > max ? p.snapshot_time : max),
        group[0].snapshot_time,
      )
      const pairSeen = new Set<string>()

      for (const overRow of bestOverBySource.values()) {
        for (const underRow of bestUnderBySource.values()) {
          if (overRow.source_id === underRow.source_id) continue
          const overProb = americanToImpliedProb(overRow.over_price)
          const underProb = americanToImpliedProb(underRow.under_price)
          const combinedProb = overProb + underProb
          if (!isFinite(overProb) || !isFinite(underProb) || combinedProb <= 0) continue
          const profitPct = (1 / combinedProb - 1) * 100
          if (!isFinite(profitPct) || profitPct <= 0) continue

          const pairKey = `${overRow.source_id}|${underRow.source_id}`
          if (pairSeen.has(pairKey)) continue
          pairSeen.add(pairKey)

          const ev = (overRow as any).event
          propArbs.push({
            eventId: overRow.event_id,
            eventTitle: ev?.title ?? '—',
            league: ev?.league?.abbreviation ?? '—',
            propCategory: overRow.prop_category,
            playerName: overRow.player_name,
            lineValue: overRow.line_value,
            bestOverPrice: overRow.over_price,
            bestOverSource: (overRow as any).source?.name ?? '—',
            bestUnderPrice: underRow.under_price,
            bestUnderSource: (underRow as any).source?.name ?? '—',
            combinedProb,
            profitPct,
            lastUpdated: latestUpdated,
          })
        }
      }
    }
  }

  const allArbs: UnifiedArb[] = []
  for (const arb of gameArbs) {
    allArbs.push({
      id: `game::${arb.eventId}::${arb.shape}::${arb.bestHomeSource}::${arb.bestAwaySource}`,
      type: 'game',
      eventTitle: arb.eventTitle,
      league: arb.league,
      description: arb.shape === '3way' ? 'Moneyline 3W' : 'Moneyline',
      bestSideA: { label: 'Home', price: arb.bestHomePrice, source: arb.bestHomeSource },
      bestSideB: { label: 'Away', price: arb.bestAwayPrice, source: arb.bestAwaySource },
      bestDraw: arb.bestDrawPrice != null
        ? { price: arb.bestDrawPrice, source: arb.bestDrawSource ?? '—' }
        : null,
      combinedProb: arb.combinedProb,
      profitPct: arb.profitPct,
      lastUpdated: arb.lastUpdated,
    })
  }
  for (const arb of propArbs) {
    allArbs.push({
      id: `prop::${arb.eventId}::${arb.propCategory}::${arb.playerName}::${arb.lineValue}::${arb.bestOverSource}::${arb.bestUnderSource}`,
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
  if (allArbs.length > TOP_N) allArbs.length = TOP_N

  const uniqueBooks = new Set([
    ...allArbs.map(a => a.bestSideA.source),
    ...allArbs.map(a => a.bestSideB.source),
  ]).size

  return { arbs: allArbs, totalArbs, uniqueBooks }
}
