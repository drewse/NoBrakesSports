import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { WatchlistView } from '@/components/watchlist/watchlist-view'

export const metadata = { title: 'Watchlist' }

export default async function WatchlistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('subscription_tier, subscription_status').eq('id', user.id).single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const [{ data: watchlists }, { data: leaguesRaw }, { data: teamsRaw }] = await Promise.all([
    supabase
      .from('watchlists')
      .select(`*, items:watchlist_items(*, team:teams(id, name, abbreviation), league:leagues(id, name, abbreviation), event:events(id, title, start_time, status))`)
      .eq('user_id', user.id)
      .order('is_default', { ascending: false }),
    supabase.from('leagues').select('id, name, abbreviation').eq('is_active', true).order('display_order'),
    supabase.from('teams').select('id, name, abbreviation, league_id').eq('is_active', true).limit(100),
  ])
  const leagues = (leaguesRaw ?? []) as any[]
  const teams = (teamsRaw ?? []) as any[]

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[900px]">
      <div>
        <h1 className="text-lg font-bold text-white">Watchlist</h1>
        <p className="text-xs text-nb-400 mt-0.5">
          Track teams, leagues, and events
          {!isPro && ' · Free plan: up to 5 items'}
        </p>
      </div>
      <WatchlistView
        watchlists={watchlists ?? []}
        leagues={leagues ?? []}
        teams={teams ?? []}
        isPro={isPro}
        userId={user.id}
      />
    </div>
  )
}
