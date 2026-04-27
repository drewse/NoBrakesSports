import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ProGate } from '@/components/shared/pro-gate'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import { loadEv } from '@/lib/ev/loaders'
import { EvLiveWrapper } from '@/components/ev/ev-live-wrapper'

export const metadata = { title: 'Top EV Lines' }
export const dynamic = 'force-dynamic'

function marketLabel(type: string): string {
  if (type === 'moneyline') return 'Moneyline'
  if (type === 'spread') return 'Spread'
  if (type === 'total') return 'Total'
  if (type === 'prop') return 'Prop'
  return type
}

export default async function TopEvLinesPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string; market?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')
    .eq('id', user.id)
    .single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)

  const params = await searchParams
  const leagueFilter = params.league ?? 'all'
  const marketFilter = params.market ?? 'all'

  const initial = await loadEv(
    supabase as any,
    enabledBooks,
    { league: leagueFilter, market: marketFilter },
    { isPro },
  )

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 max-w-[1600px]">
      <div className="hidden lg:flex flex-wrap items-center gap-3">
        <form method="GET" className="flex items-center">
          <input type="hidden" name="market" value={marketFilter} />
          <select
            name="league"
            defaultValue={leagueFilter}
            className="bg-nb-900 border border-nb-700 text-white text-xs rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-nb-500"
          >
            <option value="all">All Leagues</option>
            {initial.leagues.map(lg => (
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

      <ProGate isPro={isPro} featureName="Top EV Lines" blur={false}>
        <EvLiveWrapper initial={initial} />
      </ProGate>
    </div>
  )
}
