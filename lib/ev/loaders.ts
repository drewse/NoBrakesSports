// Server-side loader for /top-lines (+EV). Used by both the SSR page
// and the /api/ev live-polling endpoint.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  americanToImpliedProb, getMarketShape, formatSpread,
  type MarketShape,
} from '@/lib/utils'
import { isUpcomingEvent } from '@/lib/queries'

const ABBREV_TO_SLUG: Record<string, string> = {
  EPL: 'epl',
  MLS: 'mls',
  'NCAA Soccer': 'ncaasoccer',
}

const SHARP_BOOK_SLUGS = new Set([
  'pinnacle', 'betfair_ex_eu', 'betfair_ex_au', 'matchbook', 'circa',
])
const PINNACLE_SLUG = 'pinnacle'

export interface SourceOdds { name: string; price: number; evPct: number }

export interface UnifiedEvLine {
  /** Stable identity for diffing across polls. */
  id: string
  eventId: string
  eventTitle: string
  eventStart: string
  leagueAbbrev: string
  marketType: string
  outcomeLabel: string
  lineValue: number | null
  bestPrice: number
  bestSource: string
  evPct: number
  fairProb: number
  kellyPct: number
  allSources: SourceOdds[]
  lastUpdated: string
}

export interface EvFilters {
  league?: string  // 'all' or league abbrev
  market?: string  // 'all' | 'moneyline' | 'spread' | 'total' | 'prop'
}

export interface EvResult {
  lines: UnifiedEvLine[]
  /** Available league abbreviations for filter UI. */
  leagues: string[]
  /** Number of unique events represented. */
  totalEvents: number
}

function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1
}

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

type SnapForFair = {
  home_price: number | null
  away_price: number | null
  draw_price?: number | null
  source?: { slug?: string | null } | null
}

function computeFairProbs(snaps: SnapForFair[]): { home: number; away: number; draw: number | null } | null {
  const valid = snaps.filter(s => s.home_price != null && s.away_price != null)
  if (valid.length === 0) return null
  const pin = valid.find(s => s.source?.slug === PINNACLE_SLUG)
  if (pin) {
    const h = americanToImpliedProb(pin.home_price!)
    const a = americanToImpliedProb(pin.away_price!)
    const d = pin.draw_price != null ? americanToImpliedProb(pin.draw_price) : null
    const fair = powerDevig(d != null ? [h, a, d] : [h, a])
    return { home: fair[0], away: fair[1], draw: d != null ? (fair[2] ?? null) : null }
  }
  let wH = 0, wA = 0, wD = 0, wTotal = 0, wDTotal = 0
  for (const s of valid) {
    const h = americanToImpliedProb(s.home_price!)
    const a = americanToImpliedProb(s.away_price!)
    const d = s.draw_price != null ? americanToImpliedProb(s.draw_price) : null
    const overround = h + a + (d ?? 0)
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
  return { home: wH / wTotal, away: wA / wTotal, draw: wDTotal >= 2 ? wD / wDTotal : null }
}

function computeEv(fairProb: number, americanOdds: number): number {
  return (fairProb * americanToDecimal(americanOdds) - 1) * 100
}

function kellyFraction(fairProb: number, americanOdds: number): number {
  const decOdds = americanToDecimal(americanOdds)
  const b = decOdds - 1
  const q = 1 - fairProb
  const kelly = (b * fairProb - q) / b
  return Math.max(0, kelly * 0.25)
}

const PROP_LABELS: Record<string, string> = {
  player_points: 'Pts', player_rebounds: 'Reb', player_assists: 'Ast',
  player_threes: '3PM', player_pts_reb_ast: 'PRA', player_steals: 'Stl',
  player_blocks: 'Blk', player_turnovers: 'TO', player_steals_blocks: 'Stl+Blk',
  player_pts_reb: 'P+R', player_pts_ast: 'P+A', player_ast_reb: 'R+A',
  game_total_hits: 'Game Hits',
  player_hits: 'Hits', player_home_runs: 'HR', player_rbis: 'RBI',
  player_strikeouts_p: 'K', player_earned_runs: 'ER', player_total_bases: 'TB',
  player_runs: 'Runs', player_stolen_bases: 'SB', player_walks: 'BB',
  player_hits_allowed: 'HA', pitcher_outs: 'Outs',
  player_goals: 'Goals', player_hockey_assists: 'Ast', player_hockey_points: 'Pts',
  player_shots_on_goal: 'SOG', player_saves: 'Saves', player_power_play_pts: 'PPP',
  player_soccer_goals: 'Goals', player_shots_target: 'SOT',
}

const PROP_PAGE = 1000
const TOP_N = 50

export async function loadEv(
  supabase: SupabaseClient,
  enabledBooks: Set<string> | null,
  filters: EvFilters = {},
  options: { isPro: boolean } = { isPro: true },
): Promise<EvResult> {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const snapshotsPromise = supabase
    .from('current_market_odds')
    .select(`
      id, event_id, source_id, market_type,
      home_price, away_price, draw_price,
      spread_value, total_value, line_value, over_price, under_price, snapshot_time,
      event:events(id, title, start_time, league:leagues(name, abbreviation, slug)),
      source:market_sources(id, name, slug)
    `)
    .gt('snapshot_time', cutoff)
    .in('market_type', ['moneyline', 'spread', 'total'])
    .limit(10000)

  const propCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const fetchAllProps = async (): Promise<any[]> => {
    const { count } = await supabase
      .from('prop_odds')
      .select('id', { count: 'exact', head: true })
      .gt('snapshot_time', propCutoff)
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
            over_price, under_price, snapshot_time,
            event:events(id, title, start_time, league:leagues(abbreviation)),
            source:market_sources(id, name, slug)
          `)
          .gt('snapshot_time', propCutoff)
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

  type Snap = NonNullable<typeof snapshots>[number]
  const lineOf = (s: Snap): string => {
    if (s.market_type === 'spread')  return s.spread_value != null ? String(s.spread_value) : ''
    if (s.market_type === 'total')   return s.total_value  != null ? String(s.total_value)  : ''
    return ''
  }

  const latestByKey = new Map<string, Snap>()
  for (const snap of snapshots ?? []) {
    const key = `${snap.event_id}|${snap.source_id}|${snap.market_type}|${lineOf(snap)}`
    const existing = latestByKey.get(key)
    if (!existing || snap.snapshot_time > existing.snapshot_time) {
      latestByKey.set(key, snap)
    }
  }

  const groupMap = new Map<string, Snap[]>()
  for (const snap of latestByKey.values()) {
    const sourceSlug: string = (snap as any).source?.slug ?? ''
    if (sourceSlug === 'polymarket') continue
    if (enabledBooks && !enabledBooks.has(sourceSlug)) continue
    const ev = (snap as any).event
    if (!ev) continue
    if (!isUpcomingEvent(ev.start_time)) continue
    const key = `${snap.event_id}::${snap.market_type}::${lineOf(snap)}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(snap)
  }

  type WorkingLine = Omit<UnifiedEvLine, 'id'> & { outcomeSide: 'home' | 'away' | 'draw' | 'over'; shape: MarketShape }
  const evLines: WorkingLine[] = []

  for (const snaps of groupMap.values()) {
    const event = (snaps[0] as any).event
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string = event?.league?.slug ?? ABBREV_TO_SLUG[leagueAbbrev] ?? ''
    const marketType = snaps[0].market_type as string
    const shape = getMarketShape(leagueSlug || null, null, marketType)

    const fair = computeFairProbs(
      snaps.map(s => ({
        home_price: marketType === 'total' ? ((s as any).over_price ?? s.home_price) : s.home_price,
        away_price: marketType === 'total' ? ((s as any).under_price ?? s.away_price) : s.away_price,
        draw_price: s.draw_price,
        source: (s as any).source,
      }))
    )
    if (!fair) continue

    const titleParts = (event?.title ?? '').split(' vs ')
    const homeTeam = titleParts[0]?.trim() ?? 'Home'
    const awayTeam = titleParts[1]?.trim() ?? 'Away'
    const spreadVal = snaps[0].spread_value
    const totalVal = snaps[0].total_value
    const lastUpdated = snaps.reduce(
      (max, s) => (s.snapshot_time > max ? s.snapshot_time : max),
      snaps[0].snapshot_time,
    )

    function buildLine(
      outcomeSide: WorkingLine['outcomeSide'],
      outcomeLabel: string,
      getPrice: (s: Snap) => number | null,
      fairProb: number | null,
    ) {
      if (fairProb == null || fairProb === 0) return
      const relevant = snaps.filter(s => getPrice(s) != null)
      if (relevant.length === 0) return
      const allSources: SourceOdds[] = relevant.map(s => {
        const price = getPrice(s)!
        return { name: (s as any).source?.name ?? '?', price, evPct: computeEv(fairProb, price) }
      })
      allSources.sort((a, b) => b.evPct - a.evPct)
      if (allSources.length === 0) return
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
        kellyPct: kellyFraction(fairProb, best.price) * 100,
        allSources,
        lastUpdated,
        shape,
      })
    }

    const hasPinnacle = snaps.some(s => (s as any).source?.slug === PINNACLE_SLUG)
    if (!hasPinnacle) continue
    if (shape === '3way' && fair.draw == null) continue

    if (marketType === 'moneyline') {
      buildLine('home', homeTeam, s => s.home_price, fair.home)
      buildLine('away', awayTeam, s => s.away_price, fair.away)
    } else if (marketType === 'spread' && spreadVal != null) {
      const awaySpreadVal = -spreadVal
      buildLine('home', `${homeTeam} ${formatSpread(spreadVal)}`, s => s.home_price, fair.home)
      buildLine('away', `${awayTeam} ${formatSpread(awaySpreadVal)}`, s => s.away_price, fair.away)
    } else if (marketType === 'total' && totalVal != null) {
      buildLine('over', `Over ${totalVal}`, s => (s as any).over_price ?? s.home_price, fair.home)
      buildLine('away', `Under ${totalVal}`, s => (s as any).under_price ?? s.away_price, fair.away)
    }
  }

  // Prop +EV
  const propOddsRaw: any[] = await propBatchPromises
  if (propOddsRaw && propOddsRaw.length > 0) {
    const filteredProps = propOddsRaw.filter((p: any) => {
      const slug = p.source?.slug ?? ''
      if (enabledBooks && !enabledBooks.has(slug)) return false
      if (!p.event || !isUpcomingEvent(p.event.start_time)) return false
      return true
    })
    // Dedupe by (event, category, player, line, source) keeping the most-
    // recent snapshot. The /top-lines feed was showing the same book
    // multiple times in the per-line "all sources" list (e.g. DraftKings
    // appearing 3x at +1020 for one player) because we were grouping by
    // (event, category, player, line) WITHOUT collapsing duplicate
    // source rows from the prop_odds history.
    const latestPropBySrc = new Map<string, any>()
    for (const p of filteredProps) {
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
      const twoSidedBooks = group.filter((p: any) => p.over_price != null && p.under_price != null)
      if (twoSidedBooks.length === 0) continue
      let bestBalance = Infinity
      let fairOver = 0.5, fairUnder = 0.5
      for (const p of twoSidedBooks) {
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
      const catLabel = PROP_LABELS[propCat] ?? propCat.replace('player_', '')

      for (const side of ['over', 'under'] as const) {
        const fairProb = side === 'over' ? fairOver : fairUnder
        const getPrice = (p: any) => side === 'over' ? p.over_price : p.under_price
        const allSources: SourceOdds[] = group
          .filter((p: any) => getPrice(p) != null)
          .map((p: any) => ({
            name: p.source?.name ?? '?',
            price: getPrice(p),
            evPct: computeEv(fairProb, getPrice(p)),
          }))
        if (allSources.length === 0) continue
        allSources.sort((a, b) => b.evPct - a.evPct)
        const best = allSources[0]
        if (best.evPct > 0 && isFinite(best.evPct)) {
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
            shape: '2way',
          })
        }
      }
    }
  }

  evLines.sort((a, b) => b.evPct - a.evPct)
  if (evLines.length > TOP_N) evLines.length = TOP_N

  // Filter
  const leagueFilter = filters.league ?? 'all'
  const marketFilter = filters.market ?? 'all'
  const filteredLines = evLines.filter(line => {
    const leagueMatch = leagueFilter === 'all' || line.leagueAbbrev === leagueFilter
    const marketMatch = marketFilter === 'all' || line.marketType === marketFilter
    return leagueMatch && marketMatch
  })

  const visible = options.isPro ? filteredLines : filteredLines.slice(0, 10)
  const positiveOnly = visible.filter(l => l.evPct > 0)

  const lines: UnifiedEvLine[] = positiveOnly.map(l => ({
    id: `${l.eventId}::${l.marketType}::${l.outcomeSide}::${l.lineValue ?? 'na'}::${l.outcomeLabel}`,
    eventId: l.eventId,
    eventTitle: l.eventTitle,
    eventStart: l.eventStart,
    leagueAbbrev: l.leagueAbbrev,
    marketType: l.marketType,
    outcomeLabel: l.outcomeLabel,
    lineValue: l.lineValue,
    bestPrice: l.bestPrice,
    bestSource: l.bestSource,
    evPct: l.evPct,
    fairProb: l.fairProb,
    kellyPct: l.kellyPct,
    allSources: l.allSources,
    lastUpdated: l.lastUpdated,
  }))

  const leagues = Array.from(new Set(evLines.map(l => l.leagueAbbrev).filter(l => l && l !== '—'))).sort()
  const totalEvents = new Set(lines.map(l => l.eventTitle)).size

  return { lines, leagues, totalEvents }
}
