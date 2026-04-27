import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { formatDate, formatRelativeTime } from '@/lib/utils'

export const metadata = { title: 'Admin · Users' }

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/odds')

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1200px]">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">Users <span className="text-nb-400 font-normal text-sm">({users?.length ?? 0})</span></h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-nb-900/60">
                  {['User', 'Plan', 'Status', 'Sub. Ends', 'Admin', 'Joined'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users?.map((u) => (
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
                    <td className="px-4 py-3 text-xs text-nb-400 font-mono">
                      {u.subscription_period_end ? formatDate(u.subscription_period_end) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {u.is_admin && <Badge variant="white" className="text-[10px]">Admin</Badge>}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-nb-500 font-mono">
                      {formatRelativeTime(u.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
