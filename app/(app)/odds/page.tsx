import { Suspense } from 'react'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FilterBar } from '@/components/odds/filter-bar'
import { TimeFilter } from '@/components/odds/time-filter'
import { timeRangeFromParam, type TimeRangeId } from '@/lib/odds/time-range'
import { OddsClient } from '@/components/odds/odds-client'
import { OddsSkeleton } from '@/components/odds/odds-skeleton'
import {
  selectionFromParams, planForSelection,
  type MarketSelection,
} from '@/lib/odds/market-key'
import { loadGameOdds, loadPropOdds, type Payload } from '@/lib/odds/loaders'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'

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
  const within = timeRangeFromParam(params.within)

  // Stable key that changes whenever the user picks a different
  // sport / league / market / stat / period / time-range. React
  // unmounts the OddsDataLoader subtree when this changes, which
  // makes the Suspense fallback (OddsSkeleton) render until the
  // new server-side query resolves. Without this, the page sits
  // showing the previous market's data while the new query runs.
  const selectionKey = [
    selection.sport, selection.league, selection.market,
    selection.stat ?? '', selection.period ?? '', within,
  ].join('|')

  // Layout strategy: the page is a vertical flex container that fills
  // the parent <main>'s height. The filter row is a fixed-height
  // header that never scrolls; the table region (flex-1 + overflow-
  // hidden) below has its own internal scroll with a sticky thead.
  //
  // Earlier versions of this wrapper used `-m-3 sm:-m-4 lg:-m-6` to
  // force the filter bar's bg + border-bottom edge-to-edge — but
  // <main> in the app shell has NO padding, so the negative margin
  // pulled content past <main>'s right edge, where overflow-x-hidden
  // clipped it. Visible symptom: the right end of the filter pill +
  // time-filter row was cut off. Wrapper now sits flush with <main>
  // and the filter bar's px-3/px-4/px-6 supplies its own internal
  // horizontal padding.
  return (
    <div className="flex flex-col h-full">
      {/* Sticky filter bar (top of viewport — outside the scroll area).
        * py-4 (was py-3) gives the rounded-full pill button enough
        * vertical breathing room so the search icon at its right edge
        * doesn't visually crowd the bottom border. overflow-visible is
        * explicit insurance against any ancestor clipping the pill's
        * rounded edges. */}
      <div className="shrink-0 bg-nb-950 border-b border-border px-3 sm:px-4 lg:px-6 py-4 overflow-visible">
        <div className="flex items-center justify-center gap-3 flex-wrap">
          <FilterBar selection={selection} />
          {/* useSearchParams in TimeFilter needs a Suspense boundary. */}
          <Suspense fallback={null}>
            <TimeFilter value={within} />
          </Suspense>
        </div>
      </div>

      {/* Scrollable region — the table below has its own internal
        * x+y scroll with a sticky thead so book logos persist. */}
      <div className="flex-1 min-h-0 overflow-hidden p-3 sm:p-4 lg:p-6">
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

        {plan && (
          <Suspense
            key={selectionKey}
            fallback={<OddsSkeleton kind={plan.table === 'prop_odds' ? 'props' : 'game'} />}
          >
            <OddsDataLoader selection={selection} plan={plan} within={within} />
          </Suspense>
        )}
      </div>
    </div>
  )
}

/**
 * Server component that owns the heavy data load. Suspending on this
 * (rather than the parent page) means the Suspense boundary above
 * gets to show the OddsSkeleton during the wait, and the rest of
 * the page (header, FilterBar, TimeFilter) keeps rendering.
 */
async function OddsDataLoader({
  selection,
  plan,
  within,
}: {
  selection: MarketSelection
  plan: NonNullable<ReturnType<typeof planForSelection>>
  within: TimeRangeId
}) {
  const supabase = await createClient()
  // Read enabled-books cookie so the loader can include every enabled
  // book as a column even if a given sport / market has no rows from
  // that book — coverage diagnostic. See loader notes.
  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)
  const payload: Payload = plan.table === 'prop_odds'
    ? await loadPropOdds(supabase as unknown as SupabaseClient, selection, plan, within, enabledBooks)
    : await loadGameOdds(supabase as unknown as SupabaseClient, selection, plan, within, enabledBooks)
  return <OddsClient selection={selection} initialPayload={payload} />
}
