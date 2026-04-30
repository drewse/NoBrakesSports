import { Suspense } from 'react'
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

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <FilterBar selection={selection} />
        {/* useSearchParams in TimeFilter needs a Suspense boundary. */}
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

      {plan && (
        <Suspense
          key={selectionKey}
          fallback={<OddsSkeleton kind={plan.table === 'prop_odds' ? 'props' : 'game'} />}
        >
          <OddsDataLoader selection={selection} plan={plan} within={within} />
        </Suspense>
      )}
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
  const payload: Payload = plan.table === 'prop_odds'
    ? await loadPropOdds(supabase as unknown as SupabaseClient, selection, plan, within)
    : await loadGameOdds(supabase as unknown as SupabaseClient, selection, plan, within)
  return <OddsClient selection={selection} initialPayload={payload} />
}
