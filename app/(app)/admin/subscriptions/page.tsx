import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDate, formatRelativeTime } from '@/lib/utils'

export const metadata = { title: 'Admin · Subscriptions' }

export default async function AdminSubscriptionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/dashboard')

  const { data: subs } = await supabase
    .from('profiles')
    .select('id, email, full_name, subscription_tier, subscription_status, subscription_period_end, stripe_customer_id, created_at')
    .neq('subscription_tier', 'free')
    .order('created_at', { ascending: false })

  const { data: all } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status')

  const stats = {
    pro_active: all?.filter(p => p.subscription_tier === 'pro' && p.subscription_status === 'active').length ?? 0,
    past_due: all?.filter(p => p.subscription_status === 'past_due').length ?? 0,
    canceled: all?.filter(p => p.subscription_status === 'canceled').length ?? 0,
    trialing: all?.filter(p => p.subscription_status === 'trialing').length ?? 0,
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1100px]">
      <h1 className="text-lg font-bold text-white">Subscriptions</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Pro', value: stats.pro_active },
          { label: 'Trialing', value: stats.trialing },
          { label: 'Past Due', value: stats.past_due },
          { label: 'Canceled', value: stats.canceled },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[10px] text-nb-400 uppercase tracking-wider mb-1">{s.label}</p>
              <p className="text-2xl font-bold text-white font-mono">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-nb-900/60">
                  {['User', 'Plan', 'Status', 'Period End', 'Stripe ID', 'Joined'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subs?.map((u) => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-nb-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-white">{u.full_name ?? '—'}</p>
                      <p className="text-[10px] text-nb-400">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.subscription_tier === 'pro' ? 'pro' : 'muted'} className="text-[10px]">
                        {u.subscription_tier?.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={u.subscription_status === 'active' ? 'white' : u.subscription_status === 'past_due' ? 'degraded' : 'muted'}
                        className="text-[10px]"
                      >
                        {u.subscription_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-nb-400 font-mono whitespace-nowrap">
                      {u.subscription_period_end ? formatDate(u.subscription_period_end) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[10px] text-nb-500 font-mono">
                        {u.stripe_customer_id ? `${u.stripe_customer_id.slice(0, 14)}...` : '—'}
                      </code>
                    </td>
                    <td className="px-4 py-3 text-[10px] text-nb-500 font-mono whitespace-nowrap">
                      {formatRelativeTime(u.created_at)}
                    </td>
                  </tr>
                ))}
                {!subs?.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-nb-400">No paid subscriptions yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
