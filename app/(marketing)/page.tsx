import Link from 'next/link'
import {
  TrendingUp, BarChart3, GitCompare, Bell,
  Zap, ArrowRight, ChevronDown, Activity,
  Globe, Shield, LineChart, Target, Users
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollFade } from '@/components/marketing/scroll-fade'
import { Hero } from '@/components/marketing/hero'
import { SportsbookMarquee } from '@/components/marketing/sportsbook-marquee'
import { CommunityProofSection } from '@/components/marketing/community-proof-section'
import { PricingSection } from '@/components/marketing/pricing-section'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadArbs } from '@/lib/arbitrage/loaders'

// Refresh the landing page (incl. the live arb count in the hero pill)
// every 60 seconds. Marketing visitors don't need real-time, but the
// count should feel alive across visits.
export const revalidate = 60

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

async function getLiveArbCount(): Promise<number | null> {
  // Best-effort: run the same arb loader the /arbitrage page uses.
  // Failures are silent — Hero falls back to a generic label.
  try {
    const db = createAdminClient()
    const result = await loadArbs(db as any, null)
    return result.totalArbs
  } catch {
    return null
  }
}

export default async function LandingPage() {
  const arbCount = await getLiveArbCount()
  return (
    <>
      {/* ─── Hero ─────────────────────────────────────────────────────────── */}
      <Hero arbCount={arbCount} />

      {/* ─── Sportsbook marquee ───────────────────────────────────────────── */}
      <SportsbookMarquee />

      {/* ─── Community proof / reviews carousel ───────────────────────────── */}
      <CommunityProofSection />


      {/* ─── Features ─────────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-5xl px-4 sm:px-6 py-16 sm:py-28">
        <ScrollFade>
          <div className="text-center mb-10 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-3 sm:mb-4 tracking-tight">
              Everything you need to beat the books
            </h2>
            <p className="text-nb-400 max-w-lg mx-auto text-sm sm:text-base">
              Built for serious bettors who want data-driven edges, not gut feelings.
            </p>
          </div>
        </ScrollFade>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon
            return (
              <ScrollFade key={feature.title} delay={i * 80}>
                <div className="card-lift rounded-xl border border-nb-800 bg-nb-900/80 p-5 sm:p-6 h-full hover:border-nb-600">
                  <div className="mb-3 sm:mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-nb-700 bg-nb-800">
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
      <section className="mx-auto max-w-5xl px-4 sm:px-6 pb-16 sm:pb-28">
        <ScrollFade>
          <div className="rounded-xl border border-nb-800 bg-nb-900/50 p-6 sm:p-8 md:p-12">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-8 text-center">
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
      <PricingSection />

      {/* ─── FAQ ───────────────────────────────────────────────────────────── */}
      <section id="faq" className="mx-auto max-w-2xl px-4 sm:px-6 py-16 sm:py-28">
        <ScrollFade>
          <div className="text-center mb-10 sm:mb-14">
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Frequently asked questions</h2>
          </div>
        </ScrollFade>

        <div className="space-y-3">
          {FAQS.map((faq, i) => (
            <ScrollFade key={faq.q} delay={i * 60}>
              <div className="rounded-xl border border-nb-800 bg-nb-900/60 p-4 sm:p-5 hover:border-nb-700 transition-colors">
                <p className="text-sm font-semibold text-white mb-2">{faq.q}</p>
                <p className="text-sm text-nb-400 leading-relaxed">{faq.a}</p>
              </div>
            </ScrollFade>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-4 sm:px-6 pb-16 sm:pb-28">
        <ScrollFade>
          <div className="rounded-2xl border border-nb-700/60 bg-nb-900/80 p-6 sm:p-12 lg:p-16 text-center relative overflow-hidden">
            <div className="absolute inset-0 hero-glow pointer-events-none" />
            <div className="relative">
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-3 sm:mb-4 tracking-tight">
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
