import { Check, Mail, Sparkles, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreateAffiliateForm } from '@/components/affiliate/create-affiliate-form'
import { OpenDashboardButton } from '@/components/affiliate/open-dashboard-button'

export const metadata = {
  title: 'Affiliate Program — No Brakes Sports',
  description:
    'Earn recurring commissions by referring users to NoBrakesMarket. Create a referral code and track conversions in your dashboard.',
}

const AFFILIATE_FEATURES = [
  'Create your own affiliate code',
  'Get a unique referral link',
  'Track signups and paid conversions',
  'Access your affiliate dashboard',
  'Monthly payouts after verification',
]

const PARTNER_FEATURES = [
  'Custom commission deals',
  'Custom promo codes',
  'Partner landing pages',
  'Early access to new features',
  'Priority support',
]

const PARTNER_MAILTO =
  'mailto:support@nobrakesmarket.com?subject=' +
  encodeURIComponent('Creator / Partner Program Inquiry')

export default function AffiliatePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-24">
      {/* Header */}
      <div className="text-center mb-12 sm:mb-16">
        <Badge variant="outline" className="mb-4">Affiliate Program</Badge>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white tracking-tight mb-4">
          Join the NoBrakesMarket Affiliate Program
        </h1>
        <p className="text-nb-400 max-w-xl mx-auto text-sm sm:text-base">
          Earn recurring commissions by referring users to NoBrakesMarket.
        </p>
      </div>

      {/* Two main option cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6 mb-16">
        {/* CARD 1 — Affiliate Program */}
        <div className="relative rounded-2xl border border-white/15 bg-nb-900/80 p-6 sm:p-8 transition-colors hover:border-white/25">
          <div className="absolute inset-0 rounded-2xl pointer-events-none hero-glow opacity-40" />
          <div className="relative flex flex-col h-full">
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-nb-700 bg-nb-800">
              <Sparkles className="h-5 w-5 text-white" />
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
              Affiliate Program
            </h2>
            <p className="text-sm text-nb-400 leading-relaxed mb-5">
              Create your referral code, share your link, and earn commission when users subscribe.
            </p>

            <ul className="space-y-2.5 mb-6">
              {AFFILIATE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-nb-200">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              <CreateAffiliateForm />
            </div>
          </div>
        </div>

        {/* CARD 2 — Creator & Partner Program */}
        <div className="relative rounded-2xl border border-nb-800 bg-nb-900/60 p-6 sm:p-8 transition-colors hover:border-nb-600">
          <div className="flex flex-col h-full">
            <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-lg border border-nb-700 bg-nb-800">
              <Users className="h-5 w-5 text-nb-300" />
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
              Creator &amp; Partner Program
            </h2>
            <p className="text-sm text-nb-400 leading-relaxed mb-5">
              For larger creators, communities, newsletters, and strategic partners.
            </p>

            <ul className="space-y-2.5 mb-6">
              {PARTNER_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-nb-200">
                  <Check className="h-4 w-4 text-nb-400 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <div className="mt-auto">
              <Button asChild variant="outline" size="lg" className="w-full">
                <a href={PARTNER_MAILTO}>
                  <Mail className="h-4 w-4" />
                  Email Support
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Already-an-affiliate dashboard access */}
      <div className="rounded-2xl border border-nb-800 bg-nb-900/40 p-6 sm:p-8 text-center">
        <p className="text-base sm:text-lg font-semibold text-white mb-1.5">
          Already an affiliate?
        </p>
        <p className="text-sm text-nb-400 mb-5">
          Jump straight into your dashboard to track signups and earnings.
        </p>
        <div className="flex justify-center">
          <OpenDashboardButton />
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-center text-xs text-nb-500 mt-8">
        Commissions are paid out monthly after standard verification.
        Payouts are subject to the program terms.
      </p>
    </div>
  )
}
