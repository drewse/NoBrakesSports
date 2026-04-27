// Server-side loaders for the /odds page.
//
// Used by both the SSR page (initial render) and the /api/odds route
// (client-side polling refresh). Returns JSON-serializable shapes —
// byBook is a plain Record, not a Map — so the same payload can be
// streamed via React Server Components or sent over the wire.

import type { SupabaseClient } from '@supabase/supabase-js'
import { hoursForRange, type TimeRangeId } from './time-range'
import type { MarketSelection } from './market-key'
import { planForSelection } from './market-key'

export interface OddsCell {
  sourceId: string
  homePrice: number | null
  awayPrice: number | null
}

export interface OddsRow {
  eventId: string
  title: string
  homeTeam: string
  awayTeam: string
  startTime: string
  leagueAbbrev: string
  byBook: Record<string, OddsCell>
  bestHome: number | null
  bestAway: number | null
  bestHomeBook: string | null
  bestAwayBook: string | null
  avgHome: number | null
  avgAway: number | null
}

export interface BookColumn {
  id: string
  name: string
  slug: string
}

export interface PlayerLineCell {
  sourceId: string
  line: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface PlayerPropRow {
  playerName: string
  consensusLine: number | null
  byBook: Record<string, PlayerLineCell>
  bestOver: number | null
  bestUnder: number | null
  bestOverBook: string | null
  bestUnderBook: string | null
  avgOver: number | null
  avgUnder: number | null
}

export interface PropsGameRow {
  eventId: string
  title: string
  homeTeam: string
  awayTeam: string
  startTime: string
  players: PlayerPropRow[]
}

export type GamePayload  = { kind: 'game';  rows: OddsRow[];      books: BookColumn[] }
export type PropsPayload = { kind: 'props'; rows: PropsGameRow[]; books: BookColumn[] }
export type Payload = GamePayload | PropsPayload

const PAGE = 1000

async function fetchPages<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) {
  const out: T[] = []
  for (let off = 0; ; off += PAGE) {
    const { data } = await q(off, off + PAGE - 1)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

async function loadEvents(
  supabase: SupabaseClient,
  leagueSlug: string,
  within: TimeRangeId,
) {
  const { data: leagueRow } = await supabase
    .from('leagues').select('id').eq('slug', leagueSlug).maybeSingle()
  if (!leagueRow) return [] as Array<{
    id: string; title: string; start_time: string
    league: { abbreviation: string | null } | Array<{ abbreviation: string | null }> | null
  }>

  const startCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const withinHours = hoursForRange(within)
  const endCutoff = withinHours != null
    ? new Date(Date.now() + withinHours * 60 * 60 * 1000).toISOString()
    : null

  let evQuery = supabase
    .from('events')
    .select('id, title, start_time, league:leagues(abbreviation)')
    .eq('league_id', leagueRow.id)
    .gt('start_time', startCutoff)
    .order('start_time', { ascending: true })
    .limit(300)
  if (endCutoff) evQuery = evQuery.lt('start_time', endCutoff)
  const { data: eventRows } = await evQuery

  return (eventRows ?? []) as unknown as Array<{
    id: string; title: string; start_time: string
    league: { abbreviation: string | null } | Array<{ abbreviation: string | null }> | null
  }>
}

function splitTitle(title: string): { home: string; away: string } {
  const parts = title.split(/\s+vs\.?\s+/i)
  return { home: parts[0]?.trim() ?? title, away: parts[1]?.trim() ?? '' }
}

function avgAmerican(prices: number[]): number {
  const probs = prices.map(p => p > 0 ? 100 / (p + 100) : -p / (-p + 100))
  const mean = probs.reduce((a, b) => a + b, 0) / probs.length
  if (mean >= 0.5) return -(mean / (1 - mean)) * 100
  return ((1 - mean) / mean) * 100
}

export async function loadGameOdds(
  supabase: SupabaseClient,
  selection: MarketSelection,
  plan: NonNullable<ReturnType<typeof planForSelection>>,
  within: TimeRangeId,
): Promise<GamePayload> {
  const snapshotCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const events = await loadEvents(supabase, selection.league, within)
  if (events.length === 0) return { kind: 'game', rows: [], books: [] }
  const eventIds = events.map(e => e.id)

  const allRows = await fetchPages<any>((from, to) =>
    supabase
      .from('current_market_odds')
      .select('event_id, source_id, home_price, away_price, over_price, under_price, spread_value, total_value, snapshot_time, source:market_sources(id, name, slug)')
      .in('event_id', eventIds)
      .eq('market_type', plan.value)
      .gt('snapshot_time', snapshotCutoff)
      .range(from, to),
  )

  const books: Map<string, BookColumn> = new Map()
  const byEvent = new Map<string, Record<string, OddsCell>>()

  for (const r of allRows) {
    const src = r.source as { id: string; name: string; slug: string } | null
    if (!src) continue
    books.set(src.id, { id: src.id, name: src.name, slug: src.slug })
    const top =
      plan.sideShape === 'home_away' ? r.home_price
      : r.over_price ?? r.home_price
    const bottom =
      plan.sideShape === 'home_away' ? r.away_price
      : r.under_price ?? r.away_price
    const map = byEvent.get(r.event_id) ?? {}
    map[src.id] = { sourceId: src.id, homePrice: top ?? null, awayPrice: bottom ?? null }
    byEvent.set(r.event_id, map)
  }

  const rows: OddsRow[] = events
    .map(ev => {
      const byBook = byEvent.get(ev.id) ?? {}
      const cells = Object.values(byBook)
      if (cells.length === 0) return null
      const homePrices: number[] = []
      const awayPrices: number[] = []
      let bestHome: number | null = null, bestAway: number | null = null
      let bestHomeBook: string | null = null, bestAwayBook: string | null = null
      for (const cell of cells) {
        if (cell.homePrice != null) {
          homePrices.push(cell.homePrice)
          if (bestHome == null || cell.homePrice > bestHome) {
            bestHome = cell.homePrice
            bestHomeBook = cell.sourceId
          }
        }
        if (cell.awayPrice != null) {
          awayPrices.push(cell.awayPrice)
          if (bestAway == null || cell.awayPrice > bestAway) {
            bestAway = cell.awayPrice
            bestAwayBook = cell.sourceId
          }
        }
      }
      const { home, away } = splitTitle(ev.title)
      const lg = Array.isArray(ev.league) ? ev.league[0] : ev.league
      return {
        eventId: ev.id,
        title: ev.title,
        homeTeam: home,
        awayTeam: away,
        startTime: ev.start_time,
        leagueAbbrev: lg?.abbreviation ?? '',
        byBook,
        bestHome, bestAway, bestHomeBook, bestAwayBook,
        avgHome: homePrices.length ? Math.round(avgAmerican(homePrices)) : null,
        avgAway: awayPrices.length ? Math.round(avgAmerican(awayPrices)) : null,
      } satisfies OddsRow
    })
    .filter((r): r is OddsRow => r !== null)

  // Dedupe by (sorted team pair, ET-anchored 24h day bucket). Same matchup
  // can appear on two event rows when sportsbook + prediction-market start
  // times disagree. See odds/page.tsx history for full rationale.
  const ET_OFFSET_MS = 5 * 3600 * 1000
  const dedup = new Map<string, OddsRow>()
  for (const r of rows) {
    const ts = new Date(r.startTime).getTime()
    const bucket = isFinite(ts) ? Math.floor((ts - ET_OFFSET_MS) / 86_400_000) : r.startTime.slice(0, 10)
    const teams = [r.homeTeam, r.awayTeam].map(s => (s ?? '').toLowerCase().trim()).sort().join('|')
    const key = `${teams}|${bucket}`
    const existing = dedup.get(key)
    if (!existing) { dedup.set(key, r); continue }
    const rSize = Object.keys(r.byBook).length
    const eSize = Object.keys(existing.byBook).length
    const winner = rSize >= eSize ? r : existing
    const loser  = winner === r ? existing : r
    const mergedByBook: Record<string, OddsCell> = { ...winner.byBook }
    for (const [bid, cell] of Object.entries(loser.byBook)) if (!(bid in mergedByBook)) mergedByBook[bid] = cell
    let bestHome: number | null = null, bestAway: number | null = null
    let bestHomeBook: string | null = null, bestAwayBook: string | null = null
    const homePrices: number[] = [], awayPrices: number[] = []
    for (const cell of Object.values(mergedByBook)) {
      if (cell.homePrice != null) {
        homePrices.push(cell.homePrice)
        if (bestHome == null || cell.homePrice > bestHome) { bestHome = cell.homePrice; bestHomeBook = cell.sourceId }
      }
      if (cell.awayPrice != null) {
        awayPrices.push(cell.awayPrice)
        if (bestAway == null || cell.awayPrice > bestAway) { bestAway = cell.awayPrice; bestAwayBook = cell.sourceId }
      }
    }
    dedup.set(key, {
      ...winner,
      byBook: mergedByBook,
      bestHome, bestAway, bestHomeBook, bestAwayBook,
      avgHome: homePrices.length ? Math.round(avgAmerican(homePrices)) : null,
      avgAway: awayPrices.length ? Math.round(avgAmerican(awayPrices)) : null,
    })
  }
  const cap = (v: number | null) => v != null && Math.abs(v) > 5000 ? null : v
  const deduped = [...dedup.values()].map(r => ({
    ...r,
    bestHome: cap(r.bestHome), bestAway: cap(r.bestAway),
    avgHome: cap(r.avgHome), avgAway: cap(r.avgAway),
  }))
  const eventOrder = new Map(events.map((e, i) => [e.id, i]))
  deduped.sort((a, b) => (eventOrder.get(a.eventId) ?? 0) - (eventOrder.get(b.eventId) ?? 0))

  const bookCoverage = new Map<string, number>()
  for (const r of deduped) for (const id of Object.keys(r.byBook)) {
    bookCoverage.set(id, (bookCoverage.get(id) ?? 0) + 1)
  }
  const bookList = [...books.values()].sort((a, b) => {
    const ca = bookCoverage.get(a.id) ?? 0
    const cb = bookCoverage.get(b.id) ?? 0
    if (ca !== cb) return cb - ca
    return a.name.localeCompare(b.name)
  })
  return { kind: 'game', rows: deduped, books: bookList }
}

export async function loadPropOdds(
  supabase: SupabaseClient,
  selection: MarketSelection,
  plan: NonNullable<ReturnType<typeof planForSelection>>,
  within: TimeRangeId,
): Promise<PropsPayload> {
  const snapshotCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const events = await loadEvents(supabase, selection.league, within)
  if (events.length === 0) return { kind: 'props', rows: [], books: [] }
  const eventIds = events.map(e => e.id)

  const allRows = await fetchPages<any>((from, to) =>
    supabase
      .from('prop_odds')
      .select('event_id, source_id, player_name, line_value, over_price, under_price, snapshot_time, source:market_sources(id, name, slug)')
      .in('event_id', eventIds)
      .eq('prop_category', plan.value)
      .gt('snapshot_time', snapshotCutoff)
      .range(from, to),
  )

  const books: Map<string, BookColumn> = new Map()
  const byEvent = new Map<string, Map<string, Array<PlayerLineCell>>>()

  for (const r of allRows) {
    const src = r.source as { id: string; name: string; slug: string } | null
    if (!src) continue
    if (!r.player_name) continue
    books.set(src.id, { id: src.id, name: src.name, slug: src.slug })

    let byPlayer = byEvent.get(r.event_id)
    if (!byPlayer) { byPlayer = new Map(); byEvent.set(r.event_id, byPlayer) }
    const cells = byPlayer.get(r.player_name) ?? []
    cells.push({
      sourceId: src.id,
      line: r.line_value != null ? Number(r.line_value) : null,
      overPrice: r.over_price ?? null,
      underPrice: r.under_price ?? null,
    })
    byPlayer.set(r.player_name, cells)
  }

  const rows: PropsGameRow[] = events
    .map(ev => {
      const byPlayer = byEvent.get(ev.id)
      if (!byPlayer || byPlayer.size === 0) return null
      const { home, away } = splitTitle(ev.title)
      const players: PlayerPropRow[] = []
      for (const [playerName, cells] of byPlayer) {
        const lineCounts = new Map<string, number>()
        for (const c of cells) {
          if (c.line == null) continue
          const k = String(c.line)
          lineCounts.set(k, (lineCounts.get(k) ?? 0) + 1)
        }
        let consensus: number | null = null
        let bestCount = -1
        for (const [k, n] of lineCounts) {
          const v = Number(k)
          if (n > bestCount || (n === bestCount && consensus != null && v < consensus)) {
            bestCount = n
            consensus = v
          }
        }

        const byBook: Record<string, PlayerLineCell> = {}
        for (const c of cells) {
          const existing = byBook[c.sourceId]
          if (!existing) { byBook[c.sourceId] = c; continue }
          if (consensus != null && c.line === consensus && existing.line !== consensus) {
            byBook[c.sourceId] = c
          }
        }

        const overPrices: number[] = []
        const underPrices: number[] = []
        let bestOver: number | null = null, bestUnder: number | null = null
        let bestOverBook: string | null = null, bestUnderBook: string | null = null
        for (const cell of Object.values(byBook)) {
          if (consensus != null && cell.line !== consensus) continue
          if (cell.overPrice != null) {
            overPrices.push(cell.overPrice)
            if (bestOver == null || cell.overPrice > bestOver) { bestOver = cell.overPrice; bestOverBook = cell.sourceId }
          }
          if (cell.underPrice != null) {
            underPrices.push(cell.underPrice)
            if (bestUnder == null || cell.underPrice > bestUnder) { bestUnder = cell.underPrice; bestUnderBook = cell.sourceId }
          }
        }

        players.push({
          playerName,
          consensusLine: consensus,
          byBook,
          bestOver, bestUnder, bestOverBook, bestUnderBook,
          avgOver:  overPrices.length  ? Math.round(avgAmerican(overPrices))  : null,
          avgUnder: underPrices.length ? Math.round(avgAmerican(underPrices)) : null,
        })
      }
      players.sort((a, b) => (Object.keys(b.byBook).length - Object.keys(a.byBook).length) || a.playerName.localeCompare(b.playerName))
      return {
        eventId: ev.id,
        title: ev.title,
        homeTeam: home,
        awayTeam: away,
        startTime: ev.start_time,
        players,
      } satisfies PropsGameRow
    })
    .filter((g): g is PropsGameRow => g !== null)

  const ET_OFFSET_MS = 5 * 3600 * 1000
  const propsDedup = new Map<string, PropsGameRow>()
  for (const r of rows) {
    const ts = new Date(r.startTime).getTime()
    const bucket = isFinite(ts) ? Math.floor((ts - ET_OFFSET_MS) / 86_400_000) : r.startTime.slice(0, 10)
    const teams = [r.homeTeam, r.awayTeam].map(s => (s ?? '').toLowerCase().trim()).sort().join('|')
    const key = `${teams}|${bucket}`
    const existing = propsDedup.get(key)
    const playerCount = (g: PropsGameRow) => g.players.length
    if (!existing || playerCount(r) > playerCount(existing)) {
      propsDedup.set(key, r)
    }
  }
  const dedupedProps = [...propsDedup.values()]

  const eventOrder = new Map(events.map((e, i) => [e.id, i]))
  dedupedProps.sort((a, b) => (eventOrder.get(a.eventId) ?? 0) - (eventOrder.get(b.eventId) ?? 0))

  const bookCoverage = new Map<string, number>()
  for (const g of dedupedProps) for (const p of g.players) for (const id of Object.keys(p.byBook)) {
    bookCoverage.set(id, (bookCoverage.get(id) ?? 0) + 1)
  }
  const bookList = [...books.values()].sort((a, b) => {
    const ca = bookCoverage.get(a.id) ?? 0
    const cb = bookCoverage.get(b.id) ?? 0
    if (ca !== cb) return cb - ca
    return a.name.localeCompare(b.name)
  })
  return { kind: 'props', rows: dedupedProps, books: bookList }
}
