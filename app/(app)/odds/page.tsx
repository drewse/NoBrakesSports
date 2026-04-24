import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FilterBar } from '@/components/odds/filter-bar'
import { OddsTable, type OddsRow, type BookColumn, type OddsCell } from '@/components/odds/odds-table'
import {
  selectionFromParams, planForSelection,
  type MarketSelection,
} from '@/lib/odds/market-key'

export const metadata = { title: 'Odds' }
export const dynamic = 'force-dynamic'

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

  let rows: OddsRow[] = []
  let books: BookColumn[] = []

  if (plan) {
    const payload = await loadOdds(supabase, selection, plan)
    rows = payload.rows
    books = payload.books
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4">
      {/* Centered filter bar at the top */}
      <div className="flex items-center justify-center">
        <FilterBar selection={selection} />
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

      {plan && <OddsTable selection={selection} rows={rows} books={books} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Data loading

async function loadOdds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  selection: MarketSelection,
  plan: NonNullable<ReturnType<typeof planForSelection>>,
): Promise<{ rows: OddsRow[]; books: BookColumn[] }> {
  const snapshotCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
  const leagueSlug = selection.league

  // 1. Resolve league_id → events in the window (future + last 2h grace).
  const { data: leagueRow } = await supabase
    .from('leagues').select('id').eq('slug', leagueSlug).maybeSingle()
  if (!leagueRow) return { rows: [], books: [] }

  const startCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: eventRows } = await supabase
    .from('events')
    .select('id, title, start_time, league:leagues(abbreviation)')
    .eq('league_id', leagueRow.id)
    .gt('start_time', startCutoff)
    .order('start_time', { ascending: true })
    .limit(300)

  const events = (eventRows ?? []) as unknown as Array<{
    id: string; title: string; start_time: string
    league: { abbreviation: string | null } | Array<{ abbreviation: string | null }> | null
  }>
  if (events.length === 0) return { rows: [], books: [] }

  const eventIds = events.map(e => e.id)

  // 2. Fetch odds rows for this market, paginated past the 1000-row cap.
  const fetchPages = async <T,>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null }>) => {
    const PAGE = 1000
    const out: T[] = []
    for (let off = 0; ; off += PAGE) {
      const { data } = await q(off, off + PAGE - 1)
      if (!data || data.length === 0) break
      out.push(...data)
      if (data.length < PAGE) break
    }
    return out
  }

  const allRows = plan.table === 'current_market_odds'
    ? await fetchPages<any>((from, to) =>
        supabase
          .from('current_market_odds')
          .select('event_id, source_id, home_price, away_price, over_price, under_price, spread_value, total_value, snapshot_time, source:market_sources(id, name, slug)')
          .in('event_id', eventIds)
          .eq('market_type', plan.value)
          .gt('snapshot_time', snapshotCutoff)
          .range(from, to),
      )
    : await fetchPages<any>((from, to) =>
        supabase
          .from('prop_odds')
          .select('event_id, source_id, over_price, under_price, line_value, snapshot_time, source:market_sources(id, name, slug)')
          .in('event_id', eventIds)
          .eq('prop_category', plan.value)
          .gt('snapshot_time', snapshotCutoff)
          .range(from, to),
      )

  // 3. Shape rows — pick top (home / over) and bottom (away / under).
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
    // Last snapshot wins — pagination returns unordered but prop_odds /
    // current_market_odds already dedupe to one row per (event, source, …).
    map.set(src.id, { sourceId: src.id, homePrice: top ?? null, awayPrice: bottom ?? null })
    byEvent.set(r.event_id, map)
  }

  // 4. Compute best + average per event row.
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
      const parts = ev.title.split(/\s+vs\.?\s+/i)
      const home = parts[0]?.trim() ?? ev.title
      const away = parts[1]?.trim() ?? ''
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

  // 5. Dedupe rows that refer to the same real game. Pre-fix residual
  // events still in the DB can appear as multiple rows with the same
  // title and start date — keep whichever has the most books quoting
  // and drop the orphan. Also filters out obviously-broken best-odds
  // (abs American > 5000) that leak in when a stale row carries an
  // alt-line price written under the main market_type.
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
    return {
      ...r,
      bestHome: cap(r.bestHome),
      bestAway: cap(r.bestAway),
      avgHome: cap(r.avgHome),
      avgAway: cap(r.avgAway),
    }
  })
  // Preserve start-time ordering from the events query.
  const eventOrder = new Map(events.map((e, i) => [e.id, i]))
  deduped.sort((a, b) => (eventOrder.get(a.eventId) ?? 0) - (eventOrder.get(b.eventId) ?? 0))

  // 6. Order book columns alphabetically (stable across games).
  const bookList = [...books.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { rows: deduped, books: bookList }
}

/** Average American odds by converting to implied prob, averaging, and
 *  converting back — arithmetic mean of American odds is not meaningful. */
function avgAmerican(prices: number[]): number {
  const probs = prices.map(p => p > 0 ? 100 / (p + 100) : -p / (-p + 100))
  const mean = probs.reduce((a, b) => a + b, 0) / probs.length
  if (mean >= 0.5) return -(mean / (1 - mean)) * 100
  return ((1 - mean) / mean) * 100
}
