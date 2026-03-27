import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, CreditCard, Activity, Flag, Database, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Admin' }

const ADMIN_SECTIONS = [
  { href: '/admin/users', icon: Users, label: 'User Management', desc: 'View and manage all user accounts' },
  { href: '/admin/subscriptions', icon: CreditCard, label: 'Subscriptions', desc: 'View subscription status and billing' },
  { href: '/admin/data-health', icon: Activity, label: 'Data Source Health', desc: 'Monitor market source status' },
  { href: '/admin/feature-flags', icon: Flag, label: 'Feature Flags', desc: 'Toggle features for users or tiers' },
]

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single()

  if (!profile?.is_admin) redirect('/dashboard')

  // Summary stats
  const [
    { count: totalUsers },
    { count: proUsers },
    { data: sources },
    { count: activeAlerts },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true })
      .eq('subscription_tier', 'pro').eq('subscription_status', 'active'),
    supabase.from('market_sources').select('id, name, health_status, is_active').order('display_order'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
  ])

  const healthySources = sources?.filter((s) => s.health_status === 'healthy').length ?? 0
  const degradedSources = sources?.filter((s) => s.health_status !== 'healthy' && s.is_active).length ?? 0

  return (
    <div className="p-6 space-y-6 max-w-[1000px]">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-white">Admin Panel</h1>
        <Badge variant="white" className="text-[10px]">ADMIN</Badge>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: totalUsers ?? 0 },
          { label: 'Pro Subscribers', value: proUsers ?? 0 },
          { label: 'Active Alerts', value: activeAlerts ?? 0 },
          { label: 'Sources Online', value: `${healthySources}/${sources?.length ?? 0}`, warn: degradedSources > 0 },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-[10px] text-nb-400 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-2xl font-bold font-mono ${(stat as any).warn ? 'text-nb-300' : 'text-white'}`}>
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Source health quick view */}
      {degradedSources > 0 && (
        <div className="rounded-lg border border-border bg-nb-900 p-4">
          <p className="text-xs font-semibold text-white mb-3">Source Health Issues</p>
          <div className="space-y-2">
            {sources?.filter((s) => s.health_status !== 'healthy' && s.is_active).map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <span className="text-xs text-nb-300">{s.name}</span>
                <Badge variant={s.health_status === 'degraded' ? 'degraded' : 'down_status'} className="text-[10px]">
                  {s.health_status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin sections */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ADMIN_SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <Link key={section.href} href={section.href}>
              <Card className="hover:border-nb-500 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-nb-800">
                        <Icon className="h-4 w-4 text-nb-300" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{section.label}</p>
                        <p className="text-xs text-nb-400">{section.desc}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-nb-500 shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
