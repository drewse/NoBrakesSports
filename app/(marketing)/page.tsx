import Link from 'next/link'
import {
  TrendingUp, BarChart3, GitCompare, Bell, Bookmark,
  Shield, Zap, ArrowRight, ChevronDown, Activity,
  LineChart, Globe, Lock
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const FEATURES = [
  {
    icon: BarChart3,
    title: 'Market Overview',
    description:
      'Track prices across all major sportsbooks and sources simultaneously. See the full picture at a glance.',
  },
  {
    icon: TrendingUp,
    title: 'Line Movement Tracking',
    description:
      'Monitor how prices shift over time. Visualize opening lines, peak movement, and current positions.',
  },
  {
    icon: GitCompare,
    title: 'Prediction Market Comparison',
    description:
      'Side-by-side analysis of prediction market probabilities versus sportsbook-implied prices.',
  },
  {
    icon: Bell,
    title: 'Custom Alerts',
    description:
      'Set thresholds on price movement or source divergence. Get notified when conditions you define are met.',
  },
  {
    icon: Bookmark,
    title: 'Watchlists',
    description:
      'Build personalized watchlists around teams, leagues, events, and market sources.',
  },
  {
    icon: Activity,
    title: 'Historical Analytics',
    description:
      'Access full historical snapshots. Analyze trends, volatility patterns, and market behavior over time.',
  },
  {
    icon: Globe,
    title: 'Multi-Source Aggregation',
    description:
      'Data aggregated from sportsbooks and prediction markets — normalized and comparable in one view.',
  },
  {
    icon: Shield,
    title: 'Informational Only',
    description:
      'Built for research and analysis. No wager facilitation, no affiliate flows — just clean market data.',
  },
]

const STATS = [
  { value: '8+', label: 'Market Sources' },
  { value: '500+', label: 'Daily Events Tracked' },
  { value: '10M+', label: 'Snapshots Stored' },
  { value: 'Real-time', label: 'Data Updates' },
]

const FAQS = [
  {
    q: 'What exactly is No Brakes Sports?',
    a: 'No Brakes Sports is a sports market analytics platform. We aggregate and display price data from sportsbooks and prediction markets to help users research market movements and compare sources — for informational purposes only.',
  },
  {
    q: 'Is this a sportsbook or gambling site?',
    a: 'No. We do not facilitate wagers, place bets, or provide betting recommendations. We display market data similarly to how financial data platforms display stock prices — as raw, comparative information.',
  },
  {
    q: 'What data sources do you track?',
    a: 'We aggregate from major sportsbook sources and prediction market platforms including Polymarket and Kalshi. All data is displayed for informational analysis only.',
  },
  {
    q: 'What is the difference between Free and Pro?',
    a: 'Free users get access to delayed market overviews and a limited watchlist. Pro users get real-time data, full historical access, unlimited alerts, advanced filters, data export, and the prediction market comparison tool.',
  },
  {
    q: 'Can I cancel my Pro subscription?',
    a: 'Yes. You can cancel anytime through your account billing settings. Your Pro access will continue through the end of your current billing period.',
  },
  {
    q: 'Is my payment information secure?',
    a: 'Yes. All payments are processed through Stripe, a PCI-compliant payment processor. We never store card information on our servers.',
  },
]

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden min-h-[90vh] flex items-center">
        {/* Background grid */}
        <div className="absolute inset-0 bg-grid opacity-100 pointer-events-none" />
        {/* Radial gradient */}
        <div className="absolute inset-0 bg-radial-gradient pointer-events-none" style={{
          background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.04) 0%, transparent 70%)'
        }} />

        <div className="relative mx-auto max-w-6xl px-6 py-24 text-center">
          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-nb-900 px-4 py-1.5 mb-8">
            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
            <span className="text-xs font-medium text-nb-300 tracking-wide">Sports Market Intelligence Platform</span>
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-none mb-6">
            The Bloomberg Terminal
            <br />
            <span className="text-nb-400">for Sports Markets</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg sm:text-xl text-nb-400 max-w-2xl mx-auto leading-relaxed mb-10">
            Track price movements across sportsbooks and prediction markets.
            Compare implied probabilities. Surface divergences. All in one clean, fast dashboard.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Button asChild size="xl">
              <Link href="/signup">
                Start for free
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="xl" variant="outline">
              <Link href="/pricing">
                View pricing
              </Link>
            </Button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px border border-border bg-border rounded-xl overflow-hidden max-w-3xl mx-auto">
            {STATS.map((stat) => (
              <div key={stat.label} className="bg-nb-950 px-6 py-5 text-center">
                <p className="text-2xl font-bold text-white font-mono mb-1">{stat.value}</p>
                <p className="text-xs text-nb-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-nb-500">
          <span className="text-xs">Scroll to explore</span>
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </div>
      </section>

      {/* Dashboard preview */}
      <section className="mx-auto max-w-6xl px-6 py-8">
        <div className="rounded-xl border border-border bg-nb-900 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-nb-950">
            <div className="h-2.5 w-2.5 rounded-full bg-nb-600" />
            <div className="h-2.5 w-2.5 rounded-full bg-nb-600" />
            <div className="h-2.5 w-2.5 rounded-full bg-nb-600" />
            <span className="ml-2 text-xs text-nb-400 font-mono">nobrakes.sports/dashboard</span>
          </div>
          {/* Mock dashboard UI */}
          <div className="p-6">
            {/* Stat row */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              {['Markets Tracked', 'Active Events', 'Biggest Mover', 'Divergences'].map((label, i) => (
                <div key={label} className="rounded-lg border border-border bg-nb-800 p-4">
                  <p className="text-[10px] text-nb-400 uppercase tracking-wider mb-2">{label}</p>
                  <div className="h-6 bg-nb-700 rounded shimmer" />
                </div>
              ))}
            </div>
            {/* Table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-5 gap-4 px-4 py-2 border-b border-border bg-nb-950/50">
                {['Event', 'League', 'Source', 'Price', 'Movement'].map((h) => (
                  <div key={h} className="text-[10px] text-nb-400 uppercase tracking-wider">{h}</div>
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="grid grid-cols-5 gap-4 px-4 py-3 border-b border-border/50">
                  <div className="h-3 bg-nb-700 rounded" style={{ width: `${60 + i * 8}%` }} />
                  <div className="h-3 bg-nb-800 rounded w-12" />
                  <div className="h-3 bg-nb-800 rounded w-20" />
                  <div className="h-3 bg-nb-700 rounded w-16 font-mono" />
                  <div className={`h-3 rounded w-10 ${i % 2 === 0 ? 'bg-white/20' : 'bg-nb-700'}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-24">
        <div className="text-center mb-16">
          <Badge variant="outline" className="mb-4">Platform Features</Badge>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Everything you need to analyze sports markets
          </h2>
          <p className="text-nb-400 max-w-xl mx-auto">
            Built for serious sports researchers and market watchers who want clean data and no noise.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={feature.title}
                className="rounded-lg border border-border bg-nb-900 p-5 hover:border-nb-500 transition-colors group"
              >
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-border bg-nb-800 group-hover:border-nb-500 transition-colors">
                  <Icon className="h-4 w-4 text-nb-300" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{feature.title}</h3>
                <p className="text-xs text-nb-400 leading-relaxed">{feature.description}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="border-y border-border bg-nb-900">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="flex flex-col md:flex-row items-center justify-between gap-10">
            <div>
              <Badge variant="outline" className="mb-4">Pricing</Badge>
              <h2 className="text-3xl font-bold text-white mb-3">
                Start free. Go deep with Pro.
              </h2>
              <p className="text-nb-400 max-w-md">
                Free access to delayed data and core features. Pro unlocks real-time feeds,
                full history, unlimited alerts, and advanced analytics.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 shrink-0">
              <div className="rounded-xl border border-border bg-nb-950 p-6 w-56">
                <p className="text-xs text-nb-400 uppercase tracking-wider mb-1">Free</p>
                <p className="text-3xl font-bold text-white mb-1">$0</p>
                <p className="text-xs text-nb-500 mb-4">Forever free</p>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/signup">Get started</Link>
                </Button>
              </div>
              <div className="rounded-xl border border-white/20 bg-nb-950 p-6 w-56 relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge variant="white" className="text-[10px]">Most Popular</Badge>
                </div>
                <p className="text-xs text-nb-400 uppercase tracking-wider mb-1">Pro</p>
                <p className="text-3xl font-bold text-white mb-1">$50</p>
                <p className="text-xs text-nb-500 mb-4">per month</p>
                <Button asChild size="sm" className="w-full">
                  <Link href="/signup">Start Pro</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-6 py-24">
        <div className="text-center mb-12">
          <Badge variant="outline" className="mb-4">FAQ</Badge>
          <h2 className="text-3xl font-bold text-white">Frequently asked questions</h2>
        </div>

        <div className="space-y-4">
          {FAQS.map((faq) => (
            <div key={faq.q} className="rounded-lg border border-border bg-nb-900 p-5">
              <p className="text-sm font-semibold text-white mb-2">{faq.q}</p>
              <p className="text-sm text-nb-400 leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
        <div className="rounded-xl border border-border bg-nb-900 p-12">
          <h2 className="text-3xl font-bold text-white mb-4">
            Start tracking markets today
          </h2>
          <p className="text-nb-400 mb-8 max-w-md mx-auto">
            Free to start. No credit card required. Upgrade whenever you&apos;re ready for the full platform.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="lg">
              <Link href="/signup">
                Create free account
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </div>
          <p className="text-xs text-nb-500 mt-6">
            For informational use only. Not financial or gambling advice.
          </p>
        </div>
      </section>
    </>
  )
}
