import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Odds' }

/**
 * Odds — redesign target for the Markets view. Kept intentionally
 * minimal while we iterate on the layout. The existing /markets route
 * stays untouched so there's always a working fallback; once this view
 * is feature-complete we can delete the old page + route.
 */
export default async function OddsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-white">Odds</h1>
        <p className="text-xs text-nb-400">
          Redesigned markets view — under construction. The classic
          Markets tab in the sidebar stays available until this is ready.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-16 text-center space-y-3">
        <p className="text-sm font-semibold text-white">Nothing here yet</p>
        <p className="text-xs text-nb-400 max-w-sm mx-auto leading-relaxed">
          This page is the scaffold for the new odds comparison layout.
          Share the design you want and I&apos;ll wire it up here.
        </p>
      </div>
    </div>
  )
}
