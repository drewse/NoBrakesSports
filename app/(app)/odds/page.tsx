import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { FilterBar } from '@/components/odds/filter-bar'
import { TimeFilter } from '@/components/odds/time-filter'
import { timeRangeFromParam } from '@/lib/odds/time-range'
import { OddsClient } from '@/components/odds/odds-client'
import {
  selectionFromParams, planForSelection,
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

  let payload: Payload | null = null
  if (plan) {
    payload = plan.table === 'prop_odds'
      ? await loadPropOdds(supabase as any, selection, plan, within)
      : await loadGameOdds(supabase as any, selection, plan, within)
  }

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
        <Suspense fallback={null}>
          <OddsClient selection={selection} initialPayload={payload} />
        </Suspense>
      )}
    </div>
  )
}
