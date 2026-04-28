'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Sparkles } from 'lucide-react'

/**
 * Premium 3-card pricing section — Free / Pro / 3-Day Pass.
 * Glass cards on a dark backdrop with a subtle radial green/violet
 * accent behind the heading. Pro card is emphasized with a stronger
 * border + glow + "POPULAR" badge.
 *
 * Wiring:
 *   - "Get started"      → /signup           (Free tier — same as today)
 *   - "Start Pro"        → /signup?plan=pro  (Stripe handoff happens
 *                                              inside the app billing flow)
 *   - "Get 3-Day Pass"   → /signup?plan=pass (same handoff path; the
 *                                              billing page reads `plan`)
 */

interface Plan {
  id: 'free' | 'pro' | 'pass'
  title: string
  price: string
  priceUnit?: string
  subtitle: string
  featuresLabel: string
  features: string[]
  ctaLabel: string
  ctaHref: string
  badge?: string
  highlight?: boolean
  footnote?: string
}

const PLANS: Plan[] = [
  {
    id: 'free',
    title: 'Free',
    price: '$0',
    subtitle: 'For trying the platform',
    featuresLabel: 'BASIC PLAN INCLUDES',
    features: [
      'Delayed odds overview',
      'Limited market comparison',
      '3 watchlist slots',
      'Core feature access',
      'Community Discord access',
    ],
    ctaLabel: 'Get started',
    ctaHref: '/signup',
  },
  {
    id: 'pro',
    title: 'Pro',
    price: '$49',
    priceUnit: '/month',
    subtitle: 'For serious bettors',
    featuresLabel: 'EVERYTHING IN FREE, PLUS',
    features: [
      'Real-time odds from 15+ books',
      '+EV line detection',
      'Arbitrage scanner',
      'Unlimited alerts & watchlists',
      'Full historical data',
      'Priority support',
    ],
    ctaLabel: 'Start Pro',
    ctaHref: '/signup?plan=pro',
    badge: 'POPULAR',
    highlight: true,
    footnote: 'Typical arb opportunities can return $25–$50+',
  },
  {
    id: 'pass',
    title: '3-Day Pass',
    price: '$19',
    subtitle: 'Full access for 72 hours',
    featuresLabel: 'PASS INCLUDES',
    features: [
      'All Pro features',
      '72-hour full access',
      'One-time purchase',
      'No subscription required',
      'Perfect for testing premium tools',
    ],
    ctaLabel: 'Get 3-Day Pass',
    ctaHref: '/signup?plan=pass',
  },
]

export function PricingSection() {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('monthly')

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="relative overflow-hidden border-y border-white/5"
    >
      {/* Subtle radial accent behind the heading */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-[520px] w-[1100px] -translate-x-1/2 rounded-full opacity-50 blur-[140px]"
        style={{
          background:
            'radial-gradient(closest-side at 35% 50%, rgba(34,197,94,0.16), transparent 70%), ' +
            'radial-gradient(closest-side at 65% 50%, rgba(168,85,247,0.18), transparent 70%)',
        }}
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-[1280px] px-6 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-24">
        {/* Heading */}
        <div className="text-center max-w-2xl mx-auto">
          <h2
            id="pricing-heading"
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white"
          >
            Premium Features. Minimal Costs.
          </h2>
          <p className="mt-4 sm:mt-5 text-sm sm:text-base text-nb-300 leading-relaxed">
            Start free, upgrade when you want real-time odds, +EV tools,
            and full market access.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="mt-8 sm:mt-10 flex flex-col items-center gap-2">
          <div
            role="tablist"
            aria-label="Billing period"
            className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1 backdrop-blur"
          >
            <button
              type="button"
              role="tab"
              aria-selected={billing === 'monthly'}
              onClick={() => setBilling('monthly')}
              className={`h-9 px-4 text-xs font-semibold rounded-lg transition-colors ${
                billing === 'monthly'
                  ? 'bg-white text-nb-950'
                  : 'text-nb-300 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={billing === 'yearly'}
              aria-disabled
              disabled
              onClick={() => { /* coming soon — disabled */ }}
              className="h-9 px-4 text-xs font-semibold rounded-lg text-nb-500 cursor-not-allowed opacity-60"
            >
              Yearly
            </button>
          </div>
          <p className="text-[11px] text-nb-500 uppercase tracking-wider">
            Yearly plans coming soon
          </p>
        </div>

        {/* Cards */}
        <div className="mt-10 sm:mt-14 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-7 items-stretch">
          {PLANS.map(plan => (
            <PriceCard key={plan.id} plan={plan} />
          ))}
        </div>
      </div>
    </section>
  )
}

function PriceCard({ plan }: { plan: Plan }) {
  const baseCard =
    'relative flex h-full flex-col rounded-3xl border bg-white/5 backdrop-blur-xl p-6 sm:p-7 lg:p-8 ' +
    'shadow-xl transition-all duration-300 hover:-translate-y-1'

  const cardCls = plan.highlight
    ? `${baseCard} border-white/20 hover:border-white/30 shadow-[0_24px_60px_-20px_rgba(168,85,247,0.35)]`
    : `${baseCard} border-white/10 hover:border-white/20`

  return (
    <article className={cardCls}>
      {plan.highlight && plan.badge && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-500 to-violet-400 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_6px_20px_rgba(168,85,247,0.45)]">
            <Sparkles className="h-3 w-3" />
            {plan.badge}
          </span>
        </div>
      )}

      {/* Title + subtitle */}
      <header>
        <h3 className="text-2xl font-bold text-white tracking-tight">{plan.title}</h3>
        <p className="mt-1 text-sm text-nb-400">{plan.subtitle}</p>
      </header>

      {/* Price */}
      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-5xl font-bold text-white tracking-tight">{plan.price}</span>
        {plan.priceUnit && (
          <span className="text-sm text-nb-400">{plan.priceUnit}</span>
        )}
      </div>

      {/* Feature label */}
      <p className="mt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-nb-500">
        {plan.featuresLabel}
      </p>

      {/* Features */}
      <ul className="mt-3 space-y-3 flex-1">
        {plan.features.map(f => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-nb-200">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                plan.highlight ? 'bg-violet-500/20 text-violet-300' : 'bg-green-500/15 text-green-400'
              }`}
              aria-hidden
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
            <span className="leading-snug">{f}</span>
          </li>
        ))}
      </ul>

      {/* Optional footnote (Pro only) */}
      {plan.footnote && (
        <p className="mt-4 text-[11px] text-nb-500 leading-relaxed">{plan.footnote}</p>
      )}

      {/* CTA */}
      <Link
        href={plan.ctaHref}
        className={`mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-semibold transition-all hover:scale-[1.02] active:scale-[0.99] ${
          plan.highlight
            ? 'bg-white text-nb-950 shadow-[0_8px_30px_rgba(255,255,255,0.18)] hover:shadow-[0_8px_40px_rgba(255,255,255,0.28)]'
            : 'border border-white/15 bg-white/5 text-white hover:bg-white/10'
        }`}
      >
        {plan.ctaLabel}
      </Link>
    </article>
  )
}
