import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, Mail, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { sanitizeAffiliateCode, type Affiliate } from '@/lib/affiliate'
import { CopyReferralLink } from '@/components/affiliate/copy-referral-link'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ id?: string }>
}

/**
 * /affiliate/dashboard?id=<code>
 *
 * Auth & ownership rules:
 *  - Must be signed in (redirect to /login).
 *  - The signed-in user must own the affiliate row matching ?id=<code>,
 *    UNLESS they are an admin. RLS already prevents cross-user reads,
 *    but we re-check explicitly so we can render a clean "not yours"
 *    message instead of a generic 404.
 *  - Missing/invalid id -> show empty state with link back to /affiliate.
 */
export default async function AffiliateDashboardPage({ searchParams }: PageProps) {
  const sp = await searchParams
  const rawId = (sp?.id ?? '').toString()
  const id = sanitizeAffiliateCode(rawId)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const next = id
      ? `/affiliate/dashboard?id=${encodeURIComponent(id)}`
      : '/affiliate/dashboard'
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  // No id param at all → guide them back to the create flow.
  if (!id) {
    return <NoCodeState />
  }

  // Read with RLS first (will only return the row if user owns it).
  let { data: affiliate } = await supabase
    .from('affiliates')
    .select('*')
    .eq('code', id)
    .maybeSingle<Affiliate>()

  // Admin override: if RLS hid the row but the user is an admin, fetch via
  // an admin-scoped read. We check is_admin on the profiles table.
  if (!affiliate) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.is_admin) {
      const { data: adminRow } = await supabase
        .from('affiliates')
        .select('*')
        .eq('code', id)
        .maybeSingle<Affiliate>()
      affiliate = adminRow
    }
  }

  if (!affiliate) {
    return <NotYoursState code={id} />
  }

  // Defense in depth: even if somehow returned, refuse to render someone
  // else's dashboard for a non-admin.
  if (affiliate.user_id !== user.id) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .maybeSingle()
    if (!profile?.is_admin) {
      return <NotYoursState code={id} />
    }
  }

  return <DashboardView affiliate={affiliate} />
}

function DashboardView({ affiliate }: { affiliate: Affiliate }) {
  const referralLink = `https://www.nobrakesmarket.com/?ref=${encodeURIComponent(affiliate.code)}`
  const created = new Date(affiliate.created_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12 sm:py-16">
      {/* Header */}
      <div className="mb-8 sm:mb-10">
        <Badge variant="outline" className="mb-3">Affiliate Dashboard</Badge>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-1.5">
          Welcome, <span className="font-mono text-emerald-300">{affiliate.code}</span>
        </h1>
        <p className="text-sm text-nb-400">
          Member since {created} · Status:{' '}
          <span className="text-white capitalize">{affiliate.status}</span>
        </p>
      </div>

      {/* Referral link */}
      <div className="rounded-xl border border-nb-800 bg-nb-900/60 p-5 sm:p-6 mb-6">
        <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-3">
          Your referral link
        </p>
        <CopyReferralLink link={referralLink} />
      </div>

      {/* Stats grid — placeholders until reporting pipeline is wired up. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <StatCard label="Signups" value="0" sub="All time" />
        <StatCard label="Paid conversions" value="0" sub="All time" />
        <StatCard label="Pending payout" value="$0" sub="This month" />
      </div>

      {/* Empty state for activity */}
      <div className="rounded-xl border border-nb-800 bg-nb-900/40 p-8 text-center">
        <Users className="h-6 w-6 text-nb-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-white mb-1.5">No referrals yet</p>
        <p className="text-xs text-nb-400 max-w-sm mx-auto">
          Share your link above. Signups and conversions will appear here automatically.
        </p>
      </div>

      {/* Support */}
      <div className="mt-8 rounded-lg border border-nb-800 bg-nb-900/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-nb-400">
          Questions about your payout, code, or program tier?
        </p>
        <Button asChild variant="outline" size="sm">
          <a href="mailto:support@nobrakesmarket.com?subject=Affiliate%20question">
            <Mail className="h-3.5 w-3.5" />
            Email support
          </a>
        </Button>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-nb-800 bg-nb-900/60 p-5">
      <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className="text-2xl font-bold text-white font-mono">{value}</p>
      <p className="text-[11px] text-nb-500 mt-1">{sub}</p>
    </div>
  )
}

function NoCodeState() {
  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-white mb-2">No affiliate code</h1>
      <p className="text-sm text-nb-400 mb-6">
        You haven&apos;t set up an affiliate code yet. Create one to access your dashboard.
      </p>
      <Button asChild size="lg">
        <Link href="/affiliate">
          Create affiliate code
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </div>
  )
}

function NotYoursState({ code }: { code: string }) {
  return (
    <div className="mx-auto max-w-md px-4 sm:px-6 py-24 text-center">
      <h1 className="text-2xl font-bold text-white mb-2">Dashboard unavailable</h1>
      <p className="text-sm text-nb-400 mb-6">
        The affiliate dashboard for{' '}
        <span className="font-mono text-nb-200">{code}</span> isn&apos;t accessible from this account.
      </p>
      <Button asChild variant="outline" size="lg">
        <Link href="/affiliate">
          Back to affiliate program
        </Link>
      </Button>
    </div>
  )
}
