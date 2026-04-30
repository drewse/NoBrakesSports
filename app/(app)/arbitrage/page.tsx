import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ProGate } from '@/components/shared/pro-gate'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import { loadArbs } from '@/lib/arbitrage/loaders'
import { ArbLiveWrapper } from '@/components/arbitrage/arb-live-wrapper'
import { ArbSkeleton } from '@/components/arbitrage/arb-skeleton'

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

