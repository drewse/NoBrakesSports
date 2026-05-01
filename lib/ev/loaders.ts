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

// Full names (was abbreviated — kept in sync with lib/arbitrage/loaders.ts
// formatPropCat). Bet cards on /top-lines + /arbitrage now read e.g.
// "Vucevic Rebounds + Assists 6.5" instead of "Vucevic R+A 6.5".
const PROP_LABELS: Record<string, string> = {
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
  player_threes: 'Threes', player_pts_reb_ast: 'Points + Rebounds + Assists',
  player_steals: 'Steals', player_blocks: 'Blocks', player_turnovers: 'Turnovers',
  player_steals_blocks: 'Steals + Blocks',
  player_pts_reb: 'Points + Rebounds', player_pts_ast: 'Points + Assists',
  player_ast_reb: 'Rebounds + Assists',
  game_total_hits: 'Game Total Hits',
  player_hits: 'Hits', player_home_runs: 'Home Runs', player_rbis: 'RBIs',
  player_strikeouts_p: 'Strikeouts', player_earned_runs: 'Earned Runs',
  player_total_bases: 'Total Bases', player_runs: 'Runs',
  player_stolen_bases: 'Stolen Bases', player_walks: 'Walks',
  player_hits_allowed: 'Hits Allowed', pitcher_outs: 'Outs Recorded',
  player_goals: 'Goals', player_hockey_assists: 'Assists',
  player_hockey_points: 'Points', player_shots_on_goal: 'Shots On Goal',
  player_saves: 'Saves', player_power_play_pts: 'Power Play Points',
  player_soccer_goals: 'Goals', player_shots_target: 'Shots On Target',
}

// PROP_PAGE MUST match Supabase PostgREST's `db-max-rows` setting.
// Project setting was raised from 1000 → 5000 on 2026-05-01 — see README /
// Supabase project settings → API → Max Rows. With db-max-rows=5000, this
// stays in step. If you ever lower db-max-rows, lower PROP_PAGE to match,
// otherwise the page-full check (`firstRows.length < PROP_PAGE`) will fire
// early and silently drop most of the prop data.
const PROP_PAGE = 5000
const TOP_N = 50

// Maximum EV% we'll surface. Cap is wide enough to allow rare
// genuine longshot edges through; the price-prob ratio + multi-book
// consensus filters below catch the obvious stale/single-book
// phantoms without killing real edge in the 20-50% band.
const MAX_EV_PCT = 50

// Minimum two-sided books required to compute a stable prop fair
// prob. With only 1 two-sided book, fairOver/fairUnder is just that
// book's de-vig — same as having no consensus at all, prone to a
// single book's error.
const MIN_PROP_TWO_SIDED_BOOKS = 2

// If the "best price" is too far from the fair probability the
// surrounding books imply, the price is almost certainly stale. Cap
// the ratio between fair-implied-price and best-price implied so
// we don't surface a +800 that's 4x wider than the live consensus.
const MAX_PRICE_PROB_RATIO = 4

export async function loadEv(
  supabase: SupabaseClient,
  enabledBooks: Set<string> | null,
  filters: EvFilters = {},
  options: { isPro: boolean } = { isPro: true },
): Promise<EvResult> {
  // Pre-filter to upcoming event IDs at the SQL layer — same fix as
  // /arbitrage. Was fetching 10k+ CMO rows + 30k+ prop rows across all
  // events (including settled ones), then dropping non-upcoming via
  // isUpcomingEvent. With this in() filter, page loads drop from
  // ~10s to ~1s (in line with /odds).
  //
  // ── SSR bottleneck history ─────────────────────────────────────
  // /top-lines was loading in 6-8s on production even after the
  // composite indexes were verified. Root cause: the embedded joins
  // in the snapshots + prop_odds queries below were duplicating the
  // same nested event/source object onto every row. At 10k snapshots
  // + 35k prop rows × ~400 bytes of repeated nested JSON = ~18MB on
  // the wire per render. The fix mirrors what /arbitrage did months
  // ago (see lib/arbitrage/loaders.ts comment block at the top of
  // loadArbs): fetch FLAT rows and reconstruct event/source/league
  // metadata from small side queries. Bench: 3-4s → ~0.8s on /top-lines.
  //
  // ── Instrumentation ────────────────────────────────────────────
  // `[loadEv]` log line at the bottom prints phase timings (events,
  // snaps, props, compute, total) + row counts. This loader runs on
  // both the SSR page-render path AND /api/ev — the SSR path was
  // entirely uninstrumented before. Grep `[loadEv]` to slice.
  const t0 = Date.now()
  const nowIso = new Date().toISOString()

  // Expand the events query to carry title + start_time + league info,
  // so we don't need embedded joins on the heavy snapshots/props rows.
  // 500 rows × small payload = ~50ms, replaces what was duplicated MB
  // of data on every snapshot/prop row.
  const [eventsRes, sourcesRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, start_time, league:leagues(name, abbreviation, slug)')
      .gt('start_time', nowIso)
      .order('start_time', { ascending: true })
      .limit(500),
    supabase
      .from('market_sources')
      .select('id, name, slug'),
  ])

  const upcomingEvents = (eventsRes.data ?? []) as any[]
  const upcomingIds = upcomingEvents.map(e => e.id as string)
  const tEvents = Date.now()
  if (upcomingIds.length === 0) {
    console.log(`[loadEv] events=${tEvents - t0}ms result=empty total=${Date.now() - t0}ms`)
    return { lines: [], leagues: [], totalEvents: 0 }
  }
  const eventById = new Map<string, any>(upcomingEvents.map(e => [e.id, e]))
  const sourceById = new Map<string, { id: string; name: string; slug: string }>(
    ((sourcesRes.data ?? []) as any[]).map(s => [s.id, s]),
  )

  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  // FLAT select — no embedded joins. event/source metadata comes from
  // eventById / sourceById maps populated from the side queries above.
  const snapshotsPromise = supabase
    .from('current_market_odds')
    .select(`
      id, event_id, source_id, market_type,
      home_price, away_price, draw_price,
      spread_value, total_value, line_value, over_price, under_price, snapshot_time
    `)
    .in('event_id', upcomingIds)
    .gt('snapshot_time', cutoff)
    .in('market_type', ['moneyline', 'spread', 'total'])
    .limit(10000)

  const propCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  // Adaptive paging — same approach as lib/arbitrage/loaders.ts.
  // Page 0 first; if it's full, fan out remaining pages in parallel.
  // With the (event_id, snapshot_time DESC) index the count(*) we
  // used to issue first is no longer worth its round trip.
  const MAX_PAGES = 8    // 40_000 prop rows cap (EV uses 30-min window) — 8 × 5000-row pages, matches PostgREST cap
  // FLAT select — same JOIN-stripping as the snapshots query above.
  const fetchPropPage = (i: number) =>
    supabase
      .from('prop_odds')
      .select(`
        event_id, source_id, prop_category, player_name, line_value,
        over_price, under_price, snapshot_time
      `)
      .in('event_id', upcomingIds)
      .gt('snapshot_time', propCutoff)
      .or('over_price.not.is.null,under_price.not.is.null')
      .range(i * PROP_PAGE, (i + 1) * PROP_PAGE - 1)
  const fetchAllProps = async (): Promise<any[]> => {
    const first = await fetchPropPage(0)
    const firstRows = first.data ?? []
    if (firstRows.length < PROP_PAGE) return firstRows
    const restBatches = await Promise.all(
      Array.from({ length: MAX_PAGES - 1 }, (_, i) => fetchPropPage(i + 1)),
    )
    const all: any[] = [...firstRows]
    for (const b of restBatches) {
      const rows = b.data ?? []
      all.push(...rows)
      if (rows.length < PROP_PAGE) break
    }
    return all
  }
  const propBatchPromises = fetchAllProps()
  const { data: snapshots } = await snapshotsPromise
  const tSnapshots = Date.now()

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
    const sourceSlug: string = sourceById.get((snap as any).source_id)?.slug ?? ''
    if (sourceSlug === 'polymarket') continue
    if (enabledBooks && !enabledBooks.has(sourceSlug)) continue
    const ev = eventById.get((snap as any).event_id)
    if (!ev) continue
    // The events query already SQL-filtered to start_time > now(), so
    // every event in eventById is upcoming. The isUpcomingEvent() guard
    // is redundant but kept as a defensive double-check for the rare
    // race where an event flips to live mid-render.
    if (!isUpcomingEvent(ev.start_time)) continue
    const key = `${snap.event_id}::${snap.market_type}::${lineOf(snap)}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(snap)
  }

  type WorkingLine = Omit<UnifiedEvLine, 'id'> & { outcomeSide: 'home' | 'away' | 'draw' | 'over'; shape: MarketShape }
  const evLines: WorkingLine[] = []

  for (const groupSnaps of groupMap.values()) {
    const event = eventById.get((groupSnaps[0] as any).event_id)
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string = event?.league?.slug ?? ABBREV_TO_SLUG[leagueAbbrev] ?? ''
    const marketType = groupSnaps[0].market_type as string
    const shape = getMarketShape(leagueSlug || null, null, marketType)

    // Direction-disagreement filter (moneyline / spread only). Same fix
    // as /arbitrage: a minority of books may have home/away semantically
    // inverted vs the canonical event, producing phantom +EV when their
    // home_price is paired against the consensus's away_price. Drop the
    // minority orientation before computing fair probs + EV.
    let snaps = groupSnaps
    if (shape === '2way' && (marketType === 'moneyline' || marketType === 'spread')) {
      let homeAsFav = 0, homeAsDog = 0
      for (const s of groupSnaps as any[]) {
        if (s.home_price == null || s.away_price == null) continue
        const hp = americanToImpliedProb(s.home_price)
        const ap = americanToImpliedProb(s.away_price)
        if (hp > ap) homeAsFav++
        else if (ap > hp) homeAsDog++
      }
      if (homeAsFav + homeAsDog >= 4 && Math.abs(homeAsFav - homeAsDog) >= 2) {
        const consensusHomeIsFav = homeAsFav > homeAsDog
        snaps = groupSnaps.filter((s: any) => {
          if (s.home_price == null || s.away_price == null) return true
          const hp = americanToImpliedProb(s.home_price)
          const ap = americanToImpliedProb(s.away_price)
          if (hp === ap) return true
          return (hp > ap) === consensusHomeIsFav
        })
        if (snaps.length === 0) continue
      }
    }

    // Inject source from sourceById map — the snapshots themselves no
    // longer carry the embedded join, so we look it up by source_id.
    // computeFairProbs only needs source.slug (Pinnacle priority + sharp-book bonus).
    const fair = computeFairProbs(
      snaps.map(s => ({
        home_price: marketType === 'total' ? ((s as any).over_price ?? s.home_price) : s.home_price,
        away_price: marketType === 'total' ? ((s as any).under_price ?? s.away_price) : s.away_price,
        draw_price: s.draw_price,
        source: sourceById.get((s as any).source_id) ?? null,
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
        const src = sourceById.get((s as any).source_id)
        return { name: src?.name ?? '?', price, evPct: computeEv(fairProb, price) }
      })
      allSources.sort((a, b) => b.evPct - a.evPct)
      if (allSources.length === 0) return
      const best = allSources[0]
      // Cap EV% — anything > MAX_EV_PCT is virtually always a stale
      // best-price or a wrong fair-prob.
      if (!isFinite(best.evPct) || best.evPct > MAX_EV_PCT) return
      // Reject when the best price implies a probability wildly off
      // from the fair prob (stale longshot indicator).
      const bestImplied = americanToImpliedProb(best.price)
      if (bestImplied > 0 && fairProb > 0) {
        const ratio = fairProb / bestImplied
        if (ratio > MAX_PRICE_PROB_RATIO || (1 / ratio) > MAX_PRICE_PROB_RATIO) return
      }
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

    const hasPinnacle = snaps.some(s => sourceById.get((s as any).source_id)?.slug === PINNACLE_SLUG)
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
  // Exclude DFS / pick-em sources (Sleeper / PrizePicks / Underdog) for
  // the same reason as /arbitrage: their "odds" are projection leans
  // for pick-count parlay payouts, not real two-sided money lines.
  // Including them produces phantom EV against real sportsbooks.
  const DFS_SLUGS = new Set(['sleeper', 'prizepicks', 'underdog'])
  const propOddsRaw: any[] = await propBatchPromises
  const tProps = Date.now()
  if (propOddsRaw && propOddsRaw.length > 0) {
    // Source/event lookups now happen via sourceById / eventById since
    // the prop rows no longer carry embedded joins. The events query
    // already filtered to upcoming, so a hit in eventById implies
    // upcoming — the isUpcomingEvent() check is defensive.
    const filteredProps = propOddsRaw.filter((p: any) => {
      const slug = sourceById.get(p.source_id)?.slug ?? ''
      if (DFS_SLUGS.has(slug)) return false
      if (enabledBooks && !enabledBooks.has(slug)) return false
      const ev = eventById.get(p.event_id)
      if (!ev || !isUpcomingEvent(ev.start_time)) return false
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
    // Same fuzzy bucket as lib/arbitrage/loaders.ts — books that ship
    // first-name-initialed labels ("A. Osuna") have to share a group with
    // the full-name version ("Alejandro Osuna") or de-vig + fair-line
    // computation runs on a half-populated bucket and EV is biased.
    const fuzzyPlayerKey = (raw: string): string => {
      const base = raw
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/'/g, '')
        .replace(/\./g, '')
        .trim()
      if (!base) return raw.toLowerCase()
      const parts = base.split(/\s+/).filter(Boolean)
      if (parts.length === 1) return parts[0]
      const first = parts[0]
      const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/i
      let last = parts[parts.length - 1]
      if (SUFFIX.test(last) && parts.length >= 2) last = parts[parts.length - 2]
      return `${first.charAt(0)}|${last}`
    }
    const propGroups = new Map<string, any[]>()
    const groupDisplayName = new Map<string, string>()
    // Inner map per group: source_id → kept row. A single book can land
    // multiple rows in the same fuzzy group when upstream writes
    // variants of the same prop (player_name with vs without stat
    // suffix — e.g. "Ceddanne Rafaela" vs "Ceddanne Rafaela Singles" —
    // OR adjacent prop_category strings like player_singles vs
    // player_total_singles). The latestPropBySrc dedup uses raw
    // player_name + raw category, so it keeps every variant. The fuzzy
    // bucket then collapses them into one display group, and the
    // calculator showed DraftKings 5-7x with different alt-line prices.
    // Dedupe per-source within each group, keeping the row with the
    // highest over_price (best for the bettor) so the displayed
    // allSources list has at most one row per book.
    const propGroupsRaw = new Map<string, Map<string, any>>()
    for (const p of latestPropBySrc.values()) {
      const fuzzy = fuzzyPlayerKey(String(p.player_name ?? ''))
      const key = `${p.event_id}|${p.prop_category}|${fuzzy}|${p.line_value}`
      if (!propGroupsRaw.has(key)) propGroupsRaw.set(key, new Map())
      const bySource = propGroupsRaw.get(key)!
      const existing = bySource.get(p.source_id)
      if (!existing) {
        bySource.set(p.source_id, p)
      } else {
        // Prefer the row with the higher over_price; fall back to
        // higher under_price if neither has over. Ties go to the
        // newer snapshot.
        const exOver = existing.over_price ?? -Infinity
        const npOver = p.over_price ?? -Infinity
        if (npOver > exOver) bySource.set(p.source_id, p)
        else if (npOver === exOver) {
          const exUnder = existing.under_price ?? -Infinity
          const npUnder = p.under_price ?? -Infinity
          if (npUnder > exUnder) bySource.set(p.source_id, p)
          else if (npUnder === exUnder && p.snapshot_time > existing.snapshot_time) {
            bySource.set(p.source_id, p)
          }
        }
      }
      const prev = groupDisplayName.get(key)
      const cand = String(p.player_name ?? '')
      if (!prev || cand.length > prev.length) groupDisplayName.set(key, cand)
    }
    // Materialize: one array per group, one row per source.
    for (const [key, bySource] of propGroupsRaw.entries()) {
      propGroups.set(key, [...bySource.values()])
    }
    for (const [groupKey, group] of propGroups.entries()) {
      const twoSidedBooks = group.filter((p: any) => p.over_price != null && p.under_price != null)
      // Require at least N two-sided books — single-book de-vig is
      // unreliable and produced most of the 100%+ phantom EVs the
      // user reported (e.g. one obscure book with stale +800 / -110
      // generated a fair_over of 0.52, then any other book showing
      // over +400 looked like 200% EV).
      if (twoSidedBooks.length < MIN_PROP_TWO_SIDED_BOOKS) continue
      // Reject when the two-sided books wildly disagree on the line —
      // means the market hasn't settled or one book has alt-line data
      // labelled as the main line. We measure spread of implied-over
      // across books; > 20pp tells us the consensus isn't there.
      const overProbs = twoSidedBooks.map((p: any) => americanToImpliedProb(p.over_price))
      const minOver = Math.min(...overProbs)
      const maxOver = Math.max(...overProbs)
      if (maxOver - minOver > 0.20) continue
      // Average the de-vigged fair probs across all two-sided books
      // (weighted by overround tightness — tighter vig = sharper book).
      // Replaces the old "pick the most-balanced single book" heuristic
      // which was vulnerable to a single bad book.
      let wOver = 0, wUnder = 0, wTotal = 0
      for (const p of twoSidedBooks) {
        const overProb = americanToImpliedProb(p.over_price)
        const underProb = americanToImpliedProb(p.under_price)
        const overround = overProb + underProb
        // Skip books with absurd vig (>15% — typically a one-sided
        // alt market mislabeled as a main O/U).
        if (overround > 1.15 || overround < 0.95) continue
        const devigged = powerDevig([overProb, underProb])
        const w = 1 / overround
        wOver += w * devigged[0]
        wUnder += w * devigged[1]
        wTotal += w
      }
      if (wTotal === 0) continue
      const fairOver = wOver / wTotal
      const fairUnder = wUnder / wTotal
      const ev = eventById.get(group[0].event_id)
      const leagueAbbrev = ev?.league?.abbreviation ?? '—'
      const propCat = group[0].prop_category as string
      const playerName = (groupDisplayName.get(groupKey) ?? group[0].player_name) as string
      const lineVal = group[0].line_value
      const catLabel = PROP_LABELS[propCat] ?? propCat.replace(/^player_/, '').replace(/_/g, ' ')

      for (const side of ['over', 'under'] as const) {
        const fairProb = side === 'over' ? fairOver : fairUnder
        const getPrice = (p: any) => side === 'over' ? p.over_price : p.under_price
        const allSources: SourceOdds[] = group
          .filter((p: any) => getPrice(p) != null)
          .map((p: any) => ({
            name: sourceById.get(p.source_id)?.name ?? '?',
            price: getPrice(p),
            evPct: computeEv(fairProb, getPrice(p)),
          }))
        if (allSources.length === 0) continue
        allSources.sort((a, b) => b.evPct - a.evPct)
        const best = allSources[0]
        // Cap EV% (same threshold as game markets) — the single
        // biggest source of phantom +EV was a stale longshot price
        // surfacing as 100%+.
        if (!isFinite(best.evPct) || best.evPct <= 0 || best.evPct > MAX_EV_PCT) continue
        // Reject if the best price's implied prob is wildly off the
        // fair prob — definite stale-price / alt-line indicator.
        const bestImplied = americanToImpliedProb(best.price)
        if (bestImplied > 0 && fairProb > 0) {
          const ratio = fairProb / bestImplied
          if (ratio > MAX_PRICE_PROB_RATIO || (1 / ratio) > MAX_PRICE_PROB_RATIO) continue
        }
        {
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

  // Single structured line — phases broken out so a slow phase is
  // immediately attributable. tProps is captured right after the
  // paginated prop fetch resolves (line above the prop section).
  // events    : initial events + sources parallel queries
  // snaps     : current_market_odds query (FLAT — no embedded joins)
  // props     : full paginated prop_odds fetch (FLAT — no embedded joins)
  // compute   : JS group + de-vig + EV + filter
  // total     : end-to-end
  const tDone = Date.now()
  console.log(
    `[loadEv] events=${tEvents - t0}ms snaps=${tSnapshots - tEvents}ms ` +
    `props=${tProps - tSnapshots}ms compute=${tDone - tProps}ms total=${tDone - t0}ms ` +
    `eventsN=${upcomingEvents.length} snapsN=${snapshots?.length ?? 0} ` +
    `propsN=${propOddsRaw.length} linesN=${lines.length}`,
  )
  return { lines, leagues, totalEvents }
}
