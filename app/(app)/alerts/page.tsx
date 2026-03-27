import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProGate } from '@/components/shared/pro-gate'
import { AlertsList } from '@/components/alerts/alerts-list'
import { CreateAlertButton } from '@/components/alerts/create-alert-button'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Alerts' }

export default async function AlertsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('subscription_tier, subscription_status').eq('id', user.id).single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const [{ data: alerts }, { data: leaguesRaw }, { data: sourcesRaw }] = await Promise.all([
    supabase
      .from('alerts')
      .select('*, event:events(title), league:leagues(name, abbreviation), team:teams(name)')
      .eq('user_id', user.id)
      .neq('status', 'deleted')
      .order('created_at', { ascending: false }),
    supabase.from('leagues').select('id, name, abbreviation').eq('is_active', true).order('display_order'),
    supabase.from('market_sources').select('id, name').eq('is_active', true).order('display_order'),
  ])
  const leagues = (leaguesRaw ?? []) as any[]
  const sources = (sourcesRaw ?? []) as any[]

  return (
    <div className="p-6 space-y-6 max-w-[900px]">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-bold text-white">Alerts</h1>
            <Badge variant="pro">PRO</Badge>
          </div>
          <p className="text-xs text-nb-400">
            Get notified when market conditions match your criteria
          </p>
        </div>
        {isPro && (
          <CreateAlertButton leagues={leagues ?? []} sources={sources ?? []} userId={user.id} />
        )}
      </div>

      <ProGate isPro={isPro} featureName="Alerts" blur={false}>
        <AlertsList alerts={alerts ?? []} />
      </ProGate>
    </div>
  )
}
