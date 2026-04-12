import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, CreditCard, Activity, Flag, Database, ChevronRight, CheckCircle2, Clock, Wrench, AlertCircle } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Admin' }

const ADMIN_SECTIONS = [
  { href: '/admin/users', icon: Users, label: 'User Management', desc: 'View and manage all user accounts' },
  { href: '/admin/subscriptions', icon: CreditCard, label: 'Subscriptions', desc: 'View subscription status and billing' },
  { href: '/admin/data-health', icon: Activity, label: 'Data Source Health', desc: 'Monitor market source status' },
  { href: '/admin/feature-flags', icon: Flag, label: 'Feature Flags', desc: 'Toggle features for users or tiers' },
]

type ImplStatus = 'live' | 'partial' | 'in_progress' | 'planned' | 'blocked'

interface BookEntry {
  name: string
  slug: string
  platform: string
  difficulty: 'easy' | 'medium' | 'hard'
  status: ImplStatus
  gameLevel: boolean     // ML, spread, total
  props: boolean         // player props
  frequency: string | null // e.g. "2 min"
  notes: string
}

const BOOK_TRACKER: BookEntry[] = [
  // ── Live ───────────────────────────────────────────────────────────────
  { name: 'BetRivers ON',  slug: 'betrivers',    platform: 'Kambi',         difficulty: 'easy',   status: 'live',        gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Primary Kambi operator (rsicaon)' },
  { name: 'Unibet CA',     slug: 'unibet',       platform: 'Kambi',         difficulty: 'easy',   status: 'live',        gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Kambi operator (ubca), different odds' },
  { name: 'LeoVegas',      slug: 'leovegas',     platform: 'Kambi',         difficulty: 'easy',   status: 'live',        gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Kambi operator (leose)' },
  { name: 'Pinnacle',      slug: 'pinnacle',     platform: 'Pinnacle API',  difficulty: 'medium', status: 'partial',     gameLevel: true,  props: false, frequency: '5 min',  notes: 'Game-level via adapter. Props blocked from Vercel (needs proxy)' },
  { name: 'PointsBet ON',  slug: 'pointsbet_on', platform: 'PointsBet API', difficulty: 'medium', status: 'partial',     gameLevel: true,  props: false, frequency: '5 min',  notes: 'Game-level ML/spread/total only' },
  // ── Easy (Kambi) ───────────────────────────────────────────────────────
  { name: '888sport',      slug: '888sport',     platform: 'Kambi',         difficulty: 'easy',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Kambi but client ID (e888) requires auth session' },
  { name: 'BetVictor',     slug: 'betvictor',    platform: 'Kambi',         difficulty: 'easy',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Kambi but client ID (bv) requires auth session' },
  { name: 'Casumo',        slug: 'casumo',       platform: 'Kambi',         difficulty: 'easy',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Kambi but client ID (csm) requires auth session' },
  // ── Medium ─────────────────────────────────────────────────────────────
  { name: 'DraftKings',    slug: 'draftkings',   platform: 'DK API',        difficulty: 'medium', status: 'live',        gameLevel: true,  props: false, frequency: '2 min',  notes: 'Public API, no auth needed. CA-ON-SB site.' },
  { name: 'FanDuel',       slug: 'fanduel',      platform: 'FD API',        difficulty: 'medium', status: 'live',        gameLevel: true,  props: false, frequency: '2 min',  notes: 'Public API with _ak key. NBA/MLB/NHL.' },
  { name: 'bet365',        slug: 'bet365',       platform: 'Proprietary',   difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Complex proprietary API. Needs DevTools investigation' },
  { name: 'Betway',        slug: 'betway',       platform: 'Entain CDS',    difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Entain platform. Same as Sports Interaction' },
  { name: 'Sports Interaction', slug: 'sports_interaction', platform: 'Entain CDS', difficulty: 'medium', status: 'planned', gameLevel: false, props: false, frequency: null, notes: 'Entain GraphQL API. Needs DevTools investigation' },
  { name: 'BetMGM',        slug: 'betmgm',       platform: 'Roar Digital',  difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Roar Digital platform. Needs investigation' },
  { name: 'Caesars',       slug: 'caesars',       platform: 'Caesars API',   difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'William Hill legacy. Needs investigation' },
  { name: 'NorthStar Bets', slug: 'northstarbets', platform: 'Proprietary', difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Ontario-focused. Needs investigation' },
  // ── Hard ───────────────────────────────────────────────────────────────
  { name: 'theScore Bet',  slug: 'thescore',     platform: 'Penn',          difficulty: 'hard',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Penn proprietary platform. Complex' },
  { name: 'Proline (OLG)', slug: 'proline',      platform: 'OLG',           difficulty: 'hard',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Provincial lottery book. Likely scrape-only' },
  { name: 'BET99',         slug: 'bet99',        platform: 'Amelco',        difficulty: 'hard',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Amelco GraphQL over WebSocket. Complex protocol' },
  { name: 'Betano',        slug: 'betano',       platform: 'Kaizen',        difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Kaizen Gaming platform. Needs investigation' },
  { name: 'TonyBet',       slug: 'tonybet',      platform: 'Proprietary',   difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Lithuanian-origin. Needs investigation' },
  { name: 'bwin',          slug: 'bwin',         platform: 'Entain CDS',    difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Entain platform. Clone of Betway adapter' },
  { name: 'Bally Bet',     slug: 'ballybet',     platform: 'Bally Corp',    difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Bally Corp. Needs investigation' },
  { name: 'partypoker',    slug: 'partypoker',   platform: 'Entain CDS',    difficulty: 'medium', status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Entain platform. Clone of Betway adapter' },
  { name: 'Jackpot.bet',   slug: 'jackpotbet',   platform: 'Proprietary',   difficulty: 'hard',   status: 'planned',     gameLevel: false, props: false, frequency: null,     notes: 'Newer entrant. Needs investigation' },
]

function StatusPill({ status }: { status: ImplStatus }) {
  const config: Record<ImplStatus, { label: string; bg: string; text: string }> = {
    live:        { label: 'Live',        bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-400' },
    partial:     { label: 'Partial',     bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400' },
    in_progress: { label: 'In Progress', bg: 'bg-blue-500/10 border-blue-500/20',  text: 'text-blue-400' },
    planned:     { label: 'Planned',     bg: 'bg-nb-800 border-nb-700',             text: 'text-nb-400' },
    blocked:     { label: 'Blocked',     bg: 'bg-red-500/10 border-red-500/20',     text: 'text-red-400' },
  }
  const c = config[status]
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

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

      {/* Book Implementation Tracker */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Book Implementation Tracker</h2>
            <p className="text-[10px] text-nb-500 mt-0.5">
              {BOOK_TRACKER.filter(b => b.status === 'live').length} live · {BOOK_TRACKER.filter(b => b.status === 'partial').length} partial · {BOOK_TRACKER.filter(b => b.status === 'in_progress').length} in progress · {BOOK_TRACKER.filter(b => b.status === 'planned').length} planned
            </p>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 rounded-full bg-nb-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400"
                style={{ width: `${Math.round((BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial').length / BOOK_TRACKER.length) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-nb-400 font-mono">
              {Math.round((BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial').length / BOOK_TRACKER.length) * 100)}%
            </span>
          </div>
        </div>

        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nb-800">
                    {['Book', 'Platform', 'Difficulty', 'Status', 'Game', 'Props', 'Frequency', 'Notes'].map(col => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BOOK_TRACKER.map(book => (
                    <tr key={book.slug} className={`border-b border-border/30 hover:bg-nb-800/20 ${
                      book.status === 'live' ? 'border-l-2 border-l-green-500/40' :
                      book.status === 'partial' ? 'border-l-2 border-l-amber-500/40' :
                      book.status === 'in_progress' ? 'border-l-2 border-l-blue-500/40' : ''
                    }`}>
                      <td className="px-3 py-2">
                        <p className="text-xs font-semibold text-white">{book.name}</p>
                        <p className="text-[10px] text-nb-600 font-mono">{book.slug}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          book.platform === 'Kambi' ? 'bg-violet-500/10 text-violet-400' :
                          book.platform.includes('Entain') ? 'bg-blue-500/10 text-blue-400' :
                          'bg-nb-800 text-nb-400'
                        }`}>
                          {book.platform}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold ${
                          book.difficulty === 'easy' ? 'text-green-400' :
                          book.difficulty === 'medium' ? 'text-amber-400' :
                          'text-red-400'
                        }`}>
                          {book.difficulty}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill status={book.status} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {book.gameLevel
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 inline" />
                          : <span className="text-nb-700">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-center">
                        {book.props
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 inline" />
                          : <span className="text-nb-700">—</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        {book.frequency
                          ? <span className="text-[10px] font-mono text-green-400">{book.frequency}</span>
                          : <span className="text-nb-700">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 max-w-[250px]">
                        <span className="text-[10px] text-nb-500">{book.notes}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
