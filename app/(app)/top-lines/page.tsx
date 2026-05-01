import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ProGate } from '@/components/shared/pro-gate'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import { loadEv } from '@/lib/ev/loaders'
import { EvLiveWrapper } from '@/components/ev/ev-live-wrapper'
import { EvSkeleton } from '@/components/ev/ev-skeleton'

export const metadata = { title: 'Top EV Lines' }
export const dynamic = 'force-dynamic'

function marketLabel(type: string): string {
  if (type === 'moneyline') return 'Moneyline'
  if (type === 'spread') return 'Spread'
  if (type === 'total') return 'Total'
  if (type === 'prop') return 'Prop'
  return type
}

// Static league list for the filter dropdown — pre-rendered with the
// page shell so it appears instantly. The dynamic count of EV lines
// arrives later via the streamed <EvDataLoader />.
const FILTER_LEAGUES = ['NBA', 'NFL', 'MLB', 'NHL', 'EPL', 'MLS', 'NCAAB', 'NCAAF']

export default async function TopEvLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; market?: string }>
}) {
  // ── SSR shell-render path ──────────────────────────────────────
  // Only the auth + searchParams checks run outside <Suspense> —
  // they're cheap (auth ~80-150ms, searchParams just unwraps the
  // promise). The profile query + heavy loadEv() are pushed inside
  // <Suspense> so the shell streams in <500ms.
  //
  // Production was showing 6-8s blank-page time because both
  // profile and loadEv were awaited at the page level. The browser
  // can't render anything until the page function returns, so the
  // user saw an empty white page during the entire loadEv call.
  // With the data fetch deferred inside Suspense, the skeleton
  // paints immediately and the data arrives when it's ready.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const leagueFilter = params.league ?? 'all'
  const marketFilter = params.market ?? 'all'

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 max-w-[1600px]">
      {/* Filter bar renders immediately — no data dependency */}
      <div className="hidden lg:flex flex-wrap items-center gap-3">
        <form method="GET" className="flex items-center">
          <input type="hidden" name="market" value={marketFilter} />
          <select
            name="league"
            defaultValue={leagueFilter}
            className="bg-nb-900 border border-nb-700 text-white text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-nb-500"
          >
            <option value="all">All Leagues</option>
            {FILTER_LEAGUES.map(lg => (
              <option key={lg} value={lg}>{lg}</option>
            ))}
          </select>
        </form>
        <form method="GET" className="flex items-center gap-1.5 flex-wrap">
          <input type="hidden" name="league" value={leagueFilter} />
          {(['all', 'moneyline', 'spread', 'total', 'prop'] as const).map(m => (
            <button
              key={m}
              name="market"
              value={m}
              type="submit"
              className={[
                'text-[10px] px-3 py-1.5 rounded border transition-colors capitalize font-medium',
                marketFilter === m
                  ? 'bg-white text-nb-950 border-white'
                  : 'bg-transparent text-nb-400 border-nb-700 hover:border-nb-500 hover:text-white',
              ].join(' ')}
            >
              {m === 'all' ? 'All Types' : marketLabel(m)}
            </button>
          ))}
        </form>
      </div>

      <Suspense key={`${leagueFilter}|${marketFilter}`} fallback={<EvSkeleton />}>
        <EvDataLoader
          userId={user.id}
          leagueFilter={leagueFilter}
          marketFilter={marketFilter}
        />
      </Suspense>
    </div>
  )
}

async function EvDataLoader({
  userId, leagueFilter, marketFilter,
}: {
  userId: string; leagueFilter: string; marketFilter: string
}) {
  // Deferred work: profile + cookies + heavy loadEv all run inside
  // Suspense. Profile + cookies fire in parallel before loadEv since
  // we need isPro to know whether to short-circuit to the gated state.
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
    return <ProGate isPro={false} featureName="Top EV Lines" blur={false}>{null}</ProGate>
  }

  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(
    enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined,
  )
  const initial = await loadEv(
    supabase as any,
    enabledBooks,
    { league: leagueFilter, market: marketFilter },
    { isPro },
  )
  return <EvLiveWrapper initial={initial} />
}
