import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ProGate } from '@/components/shared/pro-gate'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import { loadArbs } from '@/lib/arbitrage/loaders'
import { ArbLiveWrapper } from '@/components/arbitrage/arb-live-wrapper'

export const metadata = { title: 'Arbitrage' }
export const dynamic = 'force-dynamic'

export default async function ArbitragePage() {
  // Auth + isPro must resolve before we render. The heavy data load
  // happens inside <ArbDataLoader /> below, wrapped in <Suspense> so
  // the shell streams immediately.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()
  const isPro =
    profile?.subscription_tier === 'pro' &&
    profile?.subscription_status === 'active'

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 max-w-[1600px]">
      <ProGate isPro={isPro} featureName="Arbitrage" blur={false}>
        <Suspense fallback={<ArbSkeleton />}>
          <ArbDataLoader />
        </Suspense>
      </ProGate>
    </div>
  )
}

async function ArbDataLoader() {
  const supabase = await createClient()
  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(
    enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined,
  )
  const initial = await loadArbs(supabase as any, enabledBooks)
  return <ArbLiveWrapper initial={initial} />
}

function ArbSkeleton() {
  return (
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:min-h-[calc(100vh-12rem)]">
      <div className="lg:w-[72%] w-full">
        <div className="hidden lg:block mb-4">
          <div className="h-5 w-32 rounded bg-nb-800 animate-pulse mb-2" />
          <div className="h-3 w-64 rounded bg-nb-800/60 animate-pulse" />
        </div>
        <div className="rounded-xl border border-nb-800 bg-nb-900 px-8 py-24 flex flex-col items-center justify-center text-center gap-4">
          <div className="h-12 w-12 rounded-full bg-nb-800 animate-pulse" />
          <div className="h-4 w-48 rounded bg-nb-800 animate-pulse" />
          <div className="h-3 w-64 rounded bg-nb-800/60 animate-pulse" />
        </div>
      </div>
      <div className="lg:w-[28%] w-full space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-xl border border-nb-800 bg-nb-900 animate-pulse" />
        ))}
      </div>
    </div>
  )
}
