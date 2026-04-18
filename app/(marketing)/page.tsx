import Link from 'next/link'
import {
  TrendingUp, BarChart3, GitCompare, Bell,
  Zap, ArrowRight, ChevronDown, Activity,
  Globe, Shield, LineChart, Target, Users
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollFade } from '@/components/marketing/scroll-fade'

// ── Data ──────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: BarChart3,
    title: 'Real-Time Odds Tracking',
    description:
      'Compare prices across 15+ sportsbooks instantly. See who has the best line at a glance.',
  },
  {
    icon: TrendingUp,
    title: '+EV Line Detection',
    description:
      'Surface positive expected value bets by comparing sportsbook odds against sharp market consensus.',
  },
  {
    icon: GitCompare,
    title: 'Arbitrage Scanner',
    description:
      'Automatically detect guaranteed-profit arbitrage opportunities across books in real time.',
  },
  {
    icon: LineChart,
    title: 'Line Movement History',
    description:
      'Track how odds shift over time. See opening lines, steam moves, and reverse line movement.',
  },
  {
    icon: Bell,
    title: 'Smart Alerts',
    description:
      'Get notified when lines move, +EV opportunities appear, or arbitrage windows open.',
  },
  {
    icon: Globe,
    title: 'Multi-Source Aggregation',
    description:
      'Data from sportsbooks and prediction markets — normalized and comparable in one view.',
  },
]

const STATS = [
  { value: '15+', label: 'Sportsbooks Tracked' },
  { value: '500+', label: 'Daily Events' },
  { value: 'Real-time', label: 'Odds Updates' },
  { value: '24/7', label: 'Market Coverage' },
]

const FAQS = [
  {
    q: 'What exactly is No Brakes Sports?',
    a: 'A sports market analytics platform that aggregates odds from 15+ sportsbooks and prediction markets. Find +EV bets, arbitrage opportunities, and track line movements — all in one dashboard.',
  },
  {
    q: 'Is this a sportsbook or gambling site?',
    a: 'No. We display market data the same way financial platforms display stock prices — as raw, comparative information for research.',
  },
  {
    q: 'What is the difference between Free and Pro?',
    a: 'Free users get access to delayed market overviews and basic features. Pro unlocks real-time data, full historical access, unlimited alerts, arbitrage scanner, and advanced analytics.',
  },
  {
    q: 'Can I cancel my Pro subscription?',
    a: 'Yes. Cancel anytime through your account settings. Your Pro access continues through the end of your billing period.',
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <>
      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden min-h-[92vh] flex items-center">
        <div className="absolute inset-0 bg-grid opacity-100 pointer-events-none" />
        <div className="absolute inset-0 hero-glow pointer-events-none" />

        <div className="relative mx-auto max-w-4xl px-6 py-32 text-center">
          {/* Eyebrow */}
          <ScrollFade>
            <div className="inline-flex items-center gap-2 rounded-full border border-nb-700 bg-nb-900/80 px-4 py-1.5 mb-8">
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs font-medium text-nb-300 tracking-wide">Live odds from 15+ sportsbooks</span>
            </div>
          </ScrollFade>

          {/* Headline */}
          <ScrollFade delay={100}>
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.05] mb-6">
              Find +EV Bets
              <br />
              <span className="text-nb-400">Before Anyone Else</span>
            </h1>
          </ScrollFade>

          {/* Subheadline */}
          <ScrollFade delay={200}>
            <p className="text-lg sm:text-xl text-nb-400 max-w-xl mx-auto leading-relaxed mb-10">
              Compare real-time odds across every major sportsbook.
              Surface +EV lines, spot arbitrage, and track line movements — all in one fast dashboard.
            </p>
          </ScrollFade>

          {/* Single primary CTA */}
          <ScrollFade delay={300}>
            <div className="flex flex-col items-center gap-4 mb-6">
              <Button asChild size="xl" className="shadow-lg shadow-white/5">
                <Link href="/signup">
                  Start for free
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <p className="text-xs text-nb-500">No credit card required</p>
            </div>
          </ScrollFade>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-nb-600">
          <ChevronDown className="h-4 w-4 animate-bounce" />
        </div>
      </section>

      {/* ─── Product Preview ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 -mt-8 pb-24">
        <ScrollFade>
          <div className="rounded-2xl border border-nb-700/60 bg-nb-900 overflow-hidden preview-glow">
            {/* Browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-nb-800 bg-nb-950">
              <div className="flex gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-nb-700" />
                <div className="h-2.5 w-2.5 rounded-full bg-nb-700" />
                <div className="h-2.5 w-2.5 rounded-full bg-nb-700" />
              </div>
              <div className="ml-3 flex-1 max-w-xs">
                <div className="h-5 rounded-md bg-nb-800 flex items-center px-3">
                  <span className="text-[10px] text-nb-500 font-mono">nobrakes.sports/dashboard</span>
                </div>
              </div>
            </div>

            {/* Dashboard content */}
            <div className="p-6">
              {/* Stat cards */}
              <div className="grid grid-cols-4 gap-3 mb-5">
                {[
                  { label: 'Active Events', value: '247', change: '+12' },
                  { label: '+EV Opportunities', value: '18', change: '+3' },
                  { label: 'Arb Detected', value: '4', change: 'Live' },
                  { label: 'Biggest Edge', value: '4.2%', change: 'NBA' },
                ].map((stat) => (
                  <div key={stat.label} className="rounded-lg border border-nb-800 bg-nb-850 p-4">
                    <p className="text-[10px] text-nb-500 uppercase tracking-wider mb-1.5">{stat.label}</p>
                    <div className="flex items-end justify-between">
                      <span className="text-xl font-bold text-white font-mono">{stat.value}</span>
                      <span className="text-[10px] text-green-400 font-medium">{stat.change}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Table preview */}
              <div className="rounded-lg border border-nb-800 overflow-hidden">
                <div className="grid grid-cols-6 gap-4 px-4 py-2.5 border-b border-nb-800 bg-nb-900/80">
                  {['Event', 'League', 'Best Line', 'Book', 'Edge', 'Status'].map((h) => (
                    <div key={h} className="text-[10px] text-nb-500 uppercase tracking-wider font-medium">{h}</div>
                  ))}
                </div>
                {[
                  { event: 'Lakers vs Celtics', league: 'NBA', line: '-110', book: 'DraftKings', edge: '+3.2%', status: 'live' },
                  { event: 'Yankees vs Red Sox', league: 'MLB', line: '+145', book: 'FanDuel', edge: '+2.8%', status: 'live' },
                  { event: 'Chiefs vs Bills', league: 'NFL', line: '-105', book: 'BetMGM', edge: '+1.9%', status: 'pre' },
                  { event: 'Oilers vs Leafs', league: 'NHL', line: '+130', book: 'bet365', edge: '+1.5%', status: 'pre' },
                  { event: 'Arsenal vs Liverpool', league: 'EPL', line: '-120', book: 'Pinnacle', edge: '+1.2%', status: 'pre' },
                ].map((row, i) => (
                  <div key={i} className="grid grid-cols-6 gap-4 px-4 py-2.5 border-b border-nb-800/50 last:border-b-0">
                    <span className="text-xs text-nb-200 truncate">{row.event}</span>
                    <span className="text-[11px] text-nb-500 font-mono">{row.league}</span>
                    <span className="text-xs text-white font-mono font-semibold">{row.line}</span>
                    <span className="text-[11px] text-nb-400">{row.book}</span>
                    <span className="text-xs text-green-400 font-mono font-medium">{row.edge}</span>
                    <span className={`text-[10px] font-medium ${row.status === 'live' ? 'text-green-400' : 'text-nb-500'}`}>
                      {row.status === 'live' ? 'LIVE' : 'Upcoming'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollFade>
      </section>

      {/* ─── Stats bar ────────────────────────────────────────────────────── */}
      <section className="border-y border-nb-800/60">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-nb-800/60">
            {STATS.map((stat, i) => (
              <ScrollFade key={stat.label} delay={i * 80}>
                <div className="px-6 py-10 text-center">
                  <p className="text-3xl font-bold text-white font-mono mb-1">{stat.value}</p>
                  <p className="text-xs text-nb-500 tracking-wide">{stat.label}</p>
                </div>
              </ScrollFade>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-5xl px-6 py-28">
        <ScrollFade>
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
              Everything you need to beat the books
            </h2>
            <p className="text-nb-400 max-w-lg mx-auto text-base">
              Built for serious bettors who want data-driven edges, not gut feelings.
            </p>
          </div>
        </ScrollFade>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon
            return (
              <ScrollFade key={feature.title} delay={i * 80}>
                <div className="card-lift rounded-xl border border-nb-800 bg-nb-900/80 p-6 h-full hover:border-nb-600">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-nb-700 bg-nb-800">
                    <Icon className="h-5 w-5 text-nb-300" />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-sm text-nb-400 leading-relaxed">{feature.description}</p>
                </div>
              </ScrollFade>
            )
          })}
        </div>
      </section>

      {/* ─── Social Proof ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-5xl px-6 pb-28">
        <ScrollFade>
          <div className="rounded-xl border border-nb-800 bg-nb-900/50 p-8 sm:p-12">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Users className="h-4 w-4 text-nb-500" />
                  <span className="text-2xl font-bold text-white font-mono">500+</span>
                </div>
                <p className="text-xs text-nb-500">Active bettors using the platform</p>
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-nb-500" />
                  <span className="text-2xl font-bold text-white font-mono">10M+</span>
                </div>
                <p className="text-xs text-nb-500">Odds snapshots processed</p>
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-nb-500" />
                  <span className="text-2xl font-bold text-white font-mono">100%</span>
                </div>
                <p className="text-xs text-nb-500">Free to start, cancel anytime</p>
              </div>
            </div>
          </div>
        </ScrollFade>
      </section>

      {/* ─── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="border-y border-nb-800/60 bg-nb-900/40">
        <div className="mx-auto max-w-5xl px-6 py-28">
          <ScrollFade>
            <div className="text-center mb-14">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
                Simple, transparent pricing
              </h2>
              <p className="text-nb-400 max-w-md mx-auto">
                Start free. Upgrade when you want real-time data and the full toolkit.
              </p>
            </div>
          </ScrollFade>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto">
            {/* Free */}
            <ScrollFade delay={0}>
              <div className="card-lift rounded-xl border border-nb-800 bg-nb-950 p-7 h-full flex flex-col">
                <p className="text-xs text-nb-500 uppercase tracking-wider font-semibold mb-3">Free</p>
                <p className="text-4xl font-bold text-white mb-1">$0</p>
                <p className="text-xs text-nb-500 mb-6">Forever free</p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {['Delayed odds overview', 'Basic market comparison', '3 watchlist slots', 'Core features'].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-nb-400">
                      <Zap className="h-3.5 w-3.5 text-nb-600 shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/signup">Get started</Link>
                </Button>
              </div>
            </ScrollFade>

            {/* Pro */}
            <ScrollFade delay={100}>
              <div className="card-lift rounded-xl border border-white/20 bg-nb-950 p-7 h-full flex flex-col relative">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-white text-nb-950 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                </div>
                <p className="text-xs text-nb-500 uppercase tracking-wider font-semibold mb-3">Pro</p>
                <p className="text-4xl font-bold text-white mb-1">$50</p>
                <p className="text-xs text-nb-500 mb-6">per month</p>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {['Real-time odds from 15+ books', '+EV line detection', 'Arbitrage scanner', 'Unlimited alerts & watchlists', 'Full historical data', 'Priority support'].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-nb-300">
                      <Zap className="h-3.5 w-3.5 text-white shrink-0 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className="w-full">
                  <Link href="/signup">Start Pro</Link>
                </Button>
              </div>
            </ScrollFade>
          </div>
        </div>
      </section>

      {/* ─── FAQ ───────────────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-2xl px-6 py-28">
        <ScrollFade>
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold text-white tracking-tight">Frequently asked questions</h2>
          </div>
        </ScrollFade>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <ScrollFade key={faq.q} delay={i * 60}>
              <div className="rounded-xl border border-nb-800 bg-nb-900/60 p-5 hover:border-nb-700 transition-colors">
                <p className="text-sm font-semibold text-white mb-2">{faq.q}</p>
                <p className="text-sm text-nb-400 leading-relaxed">{faq.a}</p>
              </div>
            </ScrollFade>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-6 pb-28">
        <ScrollFade>
          <div className="rounded-2xl border border-nb-700/60 bg-nb-900/80 p-12 sm:p-16 text-center relative overflow-hidden">
            <div className="absolute inset-0 hero-glow pointer-events-none" />
            <div className="relative">
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4 tracking-tight">
                Ready to find your edge?
              </h2>
              <p className="text-nb-400 mb-8 max-w-md mx-auto">
                Join 500+ bettors using No Brakes Sports to find +EV lines and arbitrage opportunities.
              </p>
              <Button asChild size="xl" className="shadow-lg shadow-white/5">
                <Link href="/signup">
                  Create free account
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <p className="text-xs text-nb-600 mt-5">
                Free to start. No credit card required.
              </p>
            </div>
          </div>
        </ScrollFade>
      </section>
    </>
  )
}
