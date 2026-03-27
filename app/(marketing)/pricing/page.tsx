import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const COMPARISON = [
  { feature: 'Market overview dashboard', free: true, pro: true },
  { feature: 'League and team tracking', free: true, pro: true },
  { feature: 'Watchlist (up to 5 items)', free: true, pro: false, freeNote: '5 items' },
  { feature: 'Unlimited watchlist', free: false, pro: true },
  { feature: 'Real-time market data', free: false, pro: true },
  { feature: 'Delayed data (24h lag)', free: true, pro: false, freeNote: '24h delay' },
  { feature: 'Line movement history', free: false, pro: true },
  { feature: 'Prediction market comparisons', free: false, pro: true },
  { feature: 'Custom alerts', free: false, pro: true },
  { feature: 'Advanced filters & saved views', free: false, pro: true },
  { feature: 'Historical analytics', free: false, pro: true },
  { feature: 'Data export (CSV)', free: false, pro: true },
  { feature: 'Source divergence analysis', free: false, pro: true },
  { feature: 'Priority support', free: false, pro: true },
  { feature: 'Early access to new features', free: false, pro: true },
]

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-24">
      {/* Header */}
      <div className="text-center mb-16">
        <Badge variant="outline" className="mb-4">Pricing</Badge>
        <h1 className="text-4xl font-bold text-white mb-4">Simple, transparent pricing</h1>
        <p className="text-nb-400 max-w-lg mx-auto">
          Start free and upgrade when you need the full platform.
          No hidden fees. Cancel anytime.
        </p>
      </div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        {/* Free */}
        <div className="rounded-xl border border-border bg-nb-900 p-8">
          <div className="mb-6">
            <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-2">Free</p>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold text-white">$0</span>
              <span className="text-nb-400">/month</span>
            </div>
            <p className="text-xs text-nb-500 mt-1">No credit card required</p>
          </div>

          <Button asChild variant="outline" size="lg" className="w-full mb-6">
            <Link href="/signup">Get started free</Link>
          </Button>

          <ul className="space-y-3">
            {[
              'Delayed market overview (24h)',
              'Basic league and team tracking',
              'Up to 5 watchlist items',
              'Demo data access',
              'Community access',
            ].map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-nb-300">
                <Check className="h-4 w-4 text-nb-400 mt-0.5 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Pro */}
        <div className="rounded-xl border border-white/20 bg-nb-900 p-8 relative">
          <div className="absolute -top-3.5 left-6">
            <Badge variant="white">Most Popular</Badge>
          </div>

          <div className="mb-6">
            <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-2">Pro</p>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-bold text-white">$50</span>
              <span className="text-nb-400">/month</span>
            </div>
            <p className="text-xs text-nb-500 mt-1">Or $480/year (save $120)</p>
          </div>

          <Button asChild size="lg" className="w-full mb-6">
            <Link href="/signup?plan=pro">Start Pro</Link>
          </Button>

          <ul className="space-y-3">
            {[
              'Real-time market data across all sources',
              'Full line movement history and charts',
              'Prediction market comparisons',
              'Unlimited watchlist items',
              'Custom alerts and notifications',
              'Advanced filters and saved views',
              'Full historical analytics dashboard',
              'Data export (CSV)',
              'Source divergence analysis',
              'Priority support',
              'Early access to new features',
            ].map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-sm text-nb-200">
                <Check className="h-4 w-4 text-white mt-0.5 shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Feature comparison table */}
      <div className="rounded-xl border border-border overflow-hidden mb-16">
        <div className="grid grid-cols-3 bg-nb-900 px-6 py-4 border-b border-border">
          <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider">Feature</p>
          <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider text-center">Free</p>
          <p className="text-xs font-semibold text-white uppercase tracking-wider text-center">Pro</p>
        </div>
        {COMPARISON.map((row, i) => (
          <div
            key={row.feature}
            className={`grid grid-cols-3 px-6 py-3.5 border-b border-border/50 ${i % 2 === 0 ? 'bg-nb-950' : 'bg-nb-900'}`}
          >
            <p className="text-sm text-nb-300">{row.feature}</p>
            <div className="flex justify-center">
              {row.free ? (
                <Check className="h-4 w-4 text-nb-400" />
              ) : row.freeNote ? (
                <span className="text-xs text-nb-500">{row.freeNote}</span>
              ) : (
                <X className="h-4 w-4 text-nb-600" />
              )}
            </div>
            <div className="flex justify-center">
              {row.pro ? (
                <Check className="h-4 w-4 text-white" />
              ) : (
                <X className="h-4 w-4 text-nb-600" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Enterprise note */}
      <div className="rounded-lg border border-border bg-nb-900 p-6 text-center">
        <p className="text-sm font-semibold text-white mb-2">Need a custom plan?</p>
        <p className="text-xs text-nb-400 mb-4">
          Contact us for enterprise licensing, custom data integrations, or team accounts.
        </p>
        <Button asChild variant="outline" size="sm">
          <a href="mailto:support@nobrakes.sports">Contact us</a>
        </Button>
      </div>

      {/* Disclaimer */}
      <p className="text-center text-xs text-nb-500 mt-8">
        No Brakes Sports is a market analytics platform for informational use only.
        Not financial or gambling advice. Data may be delayed.
      </p>
    </div>
  )
}
