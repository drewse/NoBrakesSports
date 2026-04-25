import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FilterBar } from '@/components/odds/filter-bar'
import { TimeFilter } from '@/components/odds/time-filter'
import { timeRangeFromParam, hoursForRange, type TimeRangeId } from '@/lib/odds/time-range'
import { OddsTable, type OddsRow, type BookColumn, type OddsCell } from '@/components/odds/odds-table'
import { PropsTable, type PropsGameRow, type PlayerPropRow, type PlayerLineCell } from '@/components/odds/props-table'
import {
  selectionFromParams, planForSelection,
  type MarketSelection,
} from '@/lib/odds/market-key'

export const metadata = { title: 'Odds' }
export const dynamic = 'force-dynamic'

type GamePayload  = { kind: 'game';  rows: OddsRow[];      books: BookColumn[] }
type PropsPayload = { kind: 'props'; rows: PropsGameRow[]; books: BookColumn[] }
type Payload = GamePayload | PropsPayload

export default async function OddsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const selection = selectionFromParams(params)
  const plan = planForSelection(selection)
  const within = timeRangeFromParam(params.within)

  let payload: Payload | null = null
  if (plan) {
    payload = plan.table === 'prop_odds'
      ? await loadPropOdds(supabase, selection, plan, within)
      : await loadGameOdds(supabase, selection, plan, within)
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4">
      {/* Centered filter bar with time range to its right */}
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <FilterBar selection={selection} />
        {/* useSearchParams in TimeFilter needs a Suspense boundary at
         *  build time or the App Router bails the whole page out. */}
        <Suspense fallback={null}>
          <TimeFilter value={within} />
        </Suspense>
      </div>

      {!plan && (
        <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-white">Selection not yet supported</p>
          <p className="text-xs text-nb-400 max-w-md mx-auto mt-2 leading-relaxed">
            Period-specific player props and first-half team totals aren&apos;t
            in the DB schema yet. Full-game variants work — pick a different
            period or switch markets.
          </p>
        </div>
      )}

      {payload?.kind === 'game' && (
        <OddsTable selection={selection} rows={payload.rows} books={payload.books} />
      )}
      {payload?.kind === 'props' && (
        <PropsTable rows={payload.rows} books={payload.books} />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Shared helpers

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
  supabase: Awaited<ReturnType<typeof createClient>>,
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

// ─────────────────────────────────────────────────────────────────────
// Game-level data loading (moneyline / spread / total / team_total)

async function loadGameOdds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  _selection: MarketSelection,
  plan: NonNullable<ReturnType<typeof planForSelection>>,
  within: TimeRangeId,
): Promise<GamePayload> {
  const snapshotCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const events = await loadEvents(supabase, _selection.league, within)
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
  const byEvent = new Map<string, Map<string, OddsCell>>()

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
    const map = byEvent.get(r.event_id) ?? new Map<string, OddsCell>()
    map.set(src.id, { sourceId: src.id, homePrice: top ?? null, awayPrice: bottom ?? null })
    byEvent.set(r.event_id, map)
  }

  const rows: OddsRow[] = events
    .map(ev => {
      const byBook = byEvent.get(ev.id) ?? new Map<string, OddsCell>()
      if (byBook.size === 0) return null
      const homePrices: number[] = []
      const awayPrices: number[] = []
      let bestHome: number | null = null, bestAway: number | null = null
      let bestHomeBook: string | null = null, bestAwayBook: string | null = null
      for (const cell of byBook.values()) {
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

  // Dedupe same-title same-day rows; cap absurd best-odds.
  const dedup = new Map<string, OddsRow>()
  for (const r of rows) {
    const day = r.startTime.slice(0, 10)
    const key = `${r.title.toLowerCase()}|${day}`
    const existing = dedup.get(key)
    if (!existing || r.byBook.size > existing.byBook.size) {
      dedup.set(key, r)
    }
  }
  const deduped = [...dedup.values()].map(r => {
    const cap = (v: number | null) => v != null && Math.abs(v) > 5000 ? null : v
    return { ...r, bestHome: cap(r.bestHome), bestAway: cap(r.bestAway), avgHome: cap(r.avgHome), avgAway: cap(r.avgAway) }
  })
  const eventOrder = new Map(events.map((e, i) => [e.id, i]))
  deduped.sort((a, b) => (eventOrder.get(a.eventId) ?? 0) - (eventOrder.get(b.eventId) ?? 0))

  const bookList = [...books.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { kind: 'game', rows: deduped, books: bookList }
}

// ─────────────────────────────────────────────────────────────────────
// Player-prop data loading
//
// Shape: events → players → consensus line → per-book {line, over, under}.
// We pick a single "consensus line" per player (the line most books agree
// on) so Best/Avg are apples-to-apples; books quoting a different line
// for that player still appear in their own column at their own line.

async function loadPropOdds(
  supabase: Awaited<ReturnType<typeof createClient>>,
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
  // event_id → player_name → source_id → cell (one cell per book per player).
  // If a book quotes the same player at multiple lines, prefer the one
  // closest to the eventual consensus — done after we know consensus.
  const byEvent = new Map<string, Map<string, Array<PlayerLineCell & { line: number | null }>>>()

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
        // Consensus line: the line value most books quote. Ties: smaller line.
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

        // Pick one cell per book — the one matching consensus if available,
        // otherwise the book's first quote (still shows in its own column).
        const byBook = new Map<string, PlayerLineCell>()
        for (const c of cells) {
          const existing = byBook.get(c.sourceId)
          if (!existing) { byBook.set(c.sourceId, c); continue }
          if (consensus != null && c.line === consensus && existing.line !== consensus) {
            byBook.set(c.sourceId, c)
          }
        }

        const overPrices: number[] = []
        const underPrices: number[] = []
        let bestOver: number | null = null, bestUnder: number | null = null
        let bestOverBook: string | null = null, bestUnderBook: string | null = null
        for (const cell of byBook.values()) {
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
      // Sort players: most-quoted first, then alphabetical.
      players.sort((a, b) => (b.byBook.size - a.byBook.size) || a.playerName.localeCompare(b.playerName))
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

  // Preserve start-time ordering from events query.
  const eventOrder = new Map(events.map((e, i) => [e.id, i]))
  rows.sort((a, b) => (eventOrder.get(a.eventId) ?? 0) - (eventOrder.get(b.eventId) ?? 0))

  const bookList = [...books.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { kind: 'props', rows, books: bookList }
}

/** Average American odds by converting to implied prob, averaging, and
 *  converting back — arithmetic mean of American odds is not meaningful. */
function avgAmerican(prices: number[]): number {
  const probs = prices.map(p => p > 0 ? 100 / (p + 100) : -p / (-p + 100))
  const mean = probs.reduce((a, b) => a + b, 0) / probs.length
  if (mean >= 0.5) return -(mean / (1 - mean)) * 100
  return ((1 - mean) / mean) * 100
}
