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
  // ── SSR shell-render path ──────────────────────────────────────
  // Only the auth check runs outside <Suspense>: anonymous users
  // need to be redirected before any HTML ships, which means it
  // can't be inside a streaming boundary. Everything else (profile
  // / cookies / loadArbs) is now deferred behind Suspense so the
  // skeleton paints in <500ms instead of waiting on the profile
  // round-trip + heavy data fetch.
  //
  // Why this matters: production was showing 6-8s blank-page time
  // because the profile query + loadArbs were both awaited at the
  // page level, BEFORE the JSX returned. Browsers can't stream
  // anything until the page function resolves. Pushing both inside
  // <Suspense> lets the shell go out immediately and the data
  // arrive when it's ready.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 max-w-[1600px]">
      <Suspense fallback={<ArbSkeleton />}>
        <ArbDataLoader userId={user.id} />
      </Suspense>
    </div>
  )
}

async function ArbDataLoader({ userId }: { userId: string }) {
  // Deferred work: profile + cookies + heavy loadArbs all run inside
  // Suspense, so the skeleton stays visible while we work.
  // Profile + cookies are fired in parallel — saves ~50ms vs sequential.
  const supabase = await createClient()
  const [profileRes, cookieStore] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', userId)
      .single(),
    cookies(),
  ])
  const isPro =
    profileRes.data?.subscription_tier === 'pro' &&
    profileRes.data?.subscription_status === 'active'

  if (!isPro) {
    return <ProGate isPro={false} featureName="Arbitrage" blur={false}>{null}</ProGate>
  }

  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(
    enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined,
  )
  const initial = await loadArbs(supabase as any, enabledBooks)
  return <ArbLiveWrapper initial={initial} />
}
