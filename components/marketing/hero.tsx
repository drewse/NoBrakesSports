'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowRight, Activity, TrendingUp, Bell, Sparkles,
} from 'lucide-react'

/**
 * Marketing landing-page hero — split layout (text left, product mockup
 * right), with framer-motion-driven entrance + idle floats. CSS-only 3D
 * (no WebGL); the mockup uses a perspective() + rotateX/Y transform and
 * sits inside a radial green/purple glow. Floating UI chips appear at
 * staggered delays around the mockup.
 */

const ease = [0.16, 1, 0.3, 1] as const

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0 },
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Background — kept in sync with the rest of the page (grid + radial glow). */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-100" />
      <div className="pointer-events-none absolute inset-0 hero-glow" />

      {/* Radial accent lighting — green and purple */}
      <div
        className="pointer-events-none absolute -top-32 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full opacity-60 blur-[140px]"
        style={{
          background:
            'radial-gradient(closest-side, rgba(34,197,94,0.18), transparent 70%), ' +
            'radial-gradient(closest-side at 70% 50%, rgba(168,85,247,0.18), transparent 70%)',
        }}
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 pt-6 sm:pt-10 lg:pt-12 pb-6 sm:pb-8 lg:pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-center gap-12 lg:gap-10">
          {/* ── Left: copy ─────────────────────────────────────────────── */}
          <motion.div
            initial="hidden"
            animate="show"
            transition={{ staggerChildren: 0.08, delayChildren: 0.05 }}
            className="lg:col-span-6 text-center lg:text-left"
          >
            {/* Eyebrow pill */}
            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.5, ease }}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-1 backdrop-blur"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
              </span>
              <span className="text-[11px] sm:text-xs font-medium text-nb-200 tracking-wide">
                Live odds from 15+ sportsbooks
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              variants={fadeUp}
              transition={{ duration: 0.55, ease }}
              className="mt-6 text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.02] text-white"
            >
              Make $2000+ a week.
              <br />
              <span className="bg-gradient-to-br from-white via-nb-200 to-nb-500 bg-clip-text text-transparent">
                No luck involved.
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.55, ease }}
              className="mt-5 sm:mt-6 max-w-xl text-base sm:text-lg text-nb-300 leading-relaxed mx-auto lg:mx-0"
            >
              Compare live odds across sportsbooks, spot profitable lines,
              and track market movement in one fast dashboard.
            </motion.p>

            {/* CTAs */}
            <motion.div
              variants={fadeUp}
              transition={{ duration: 0.55, ease }}
              className="mt-8 flex flex-col sm:flex-row items-center lg:items-start sm:justify-start justify-center gap-3 sm:gap-4"
            >
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/signup"
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-nb-950 shadow-[0_8px_30px_rgba(255,255,255,0.18)] hover:shadow-[0_8px_40px_rgba(255,255,255,0.28)] transition-shadow"
                >
                  Start for free
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </motion.div>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/pricing"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 text-sm font-semibold text-white backdrop-blur hover:bg-white/10 transition-colors"
                >
                  View pricing
                </Link>
              </motion.div>
            </motion.div>

            <motion.p
              variants={fadeUp}
              transition={{ duration: 0.55, ease }}
              className="mt-3 text-xs text-nb-500"
            >
              No credit card required
            </motion.p>

            {/* Trust bullets */}
            <motion.ul
              variants={fadeUp}
              transition={{ duration: 0.55, ease }}
              className="mt-8 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-3"
            >
              {[
                { icon: Activity,   label: 'Live odds' },
                { icon: TrendingUp, label: '+EV detection' },
                { icon: Bell,       label: 'Arbitrage alerts' },
              ].map(({ icon: Icon, label }) => (
                <li key={label} className="inline-flex items-center gap-2 text-xs text-nb-300">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 backdrop-blur">
                    <Icon className="h-3.5 w-3.5 text-nb-200" />
                  </span>
                  {label}
                </li>
              ))}
            </motion.ul>
          </motion.div>

          {/* ── Right: 3D-styled product mockup ─────────────────────────── */}
          <div className="lg:col-span-6 relative">
            <ProductMockup />
          </div>
        </div>
      </div>
    </section>
  )
}

// ───────────────────────────────────────────────────────────────────────
// Product mockup — browser frame + dashboard preview, with CSS perspective
// and a slow vertical float loop. Floating chips orbit at staggered delays.

function ProductMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease, delay: 0.2 }}
      className="relative mx-auto w-full max-w-[640px] [perspective:1200px]"
    >
      {/* Radial color glow behind the mockup */}
      <div
        className="pointer-events-none absolute -inset-12 rounded-[40px] blur-3xl opacity-70"
        style={{
          background:
            'radial-gradient(closest-side at 30% 50%, rgba(34,197,94,0.25), transparent 70%), ' +
            'radial-gradient(closest-side at 75% 60%, rgba(168,85,247,0.22), transparent 70%)',
        }}
        aria-hidden
      />

      {/* The frame floats slowly. Transform stack: perspective is on the
       *  parent; the frame itself rotates and idle-floats in y. */}
      <motion.div
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 7, ease: 'easeInOut', repeat: Infinity }}
        className="relative will-change-transform"
        style={{ transform: 'rotateX(8deg) rotateY(-12deg)', transformStyle: 'preserve-3d' }}
      >
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-nb-900/90 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.7),0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 border-b border-white/5 bg-black/40 px-4 py-3">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
              <div className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
            </div>
            <div className="ml-3 flex-1 max-w-xs">
              <div className="h-5 rounded-md bg-white/5 flex items-center px-3 border border-white/5">
                <span className="text-[10px] text-nb-400 font-mono truncate">nobrakesmarket.com/odds</span>
              </div>
            </div>
          </div>

          {/* Faux dashboard */}
          <div className="p-4 sm:p-5 space-y-3">
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { label: 'Active',   value: '247',   tint: 'text-white' },
                { label: '+EV',      value: '18',    tint: 'text-green-400' },
                { label: 'Arb',      value: '4',     tint: 'text-violet-400' },
              ].map(s => (
                <div key={s.label} className="rounded-lg border border-white/5 bg-white/5 p-3">
                  <p className="text-[9px] uppercase tracking-wider text-nb-500">{s.label}</p>
                  <p className={`mt-1 font-mono text-base font-bold ${s.tint}`}>{s.value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-white/5 overflow-hidden">
              <div className="grid grid-cols-[1fr_56px_56px] gap-3 px-3 py-2 border-b border-white/5 bg-white/5 text-[9px] uppercase tracking-wider text-nb-500">
                <span>Event</span>
                <span className="text-right">Best</span>
                <span className="text-right">Edge</span>
              </div>
              {[
                { ev: 'Lakers vs Celtics',   best: '−110', edge: '+3.2%' },
                { ev: 'Yankees vs Red Sox',  best: '+145', edge: '+2.8%' },
                { ev: 'Chiefs vs Bills',     best: '−105', edge: '+1.9%' },
                { ev: 'Oilers vs Leafs',     best: '+130', edge: '+1.5%' },
              ].map((row, i) => (
                <div key={i} className="grid grid-cols-[1fr_56px_56px] gap-3 px-3 py-2 border-b border-white/5 last:border-b-0 text-[11px]">
                  <span className="text-nb-200 truncate">{row.ev}</span>
                  <span className="text-right text-white font-mono">{row.best}</span>
                  <span className="text-right text-green-400 font-mono">{row.edge}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Floating chips */}
      <FloatChip
        className="left-[-6%] top-[18%] hidden sm:flex"
        floatDuration={5.5}
        delay={0.6}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-green-400/15 text-green-400">
          <TrendingUp className="h-3.5 w-3.5" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-semibold text-white">+12.4% EV found</p>
          <p className="text-[10px] text-nb-400">Lakers ML · DK</p>
        </div>
      </FloatChip>

      <FloatChip
        className="right-[-4%] top-[8%] hidden sm:flex"
        floatDuration={6.5}
        delay={0.85}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-400/15 text-violet-300">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-semibold text-white">Arb alert</p>
          <p className="text-[10px] text-nb-400">2.1% on Yankees ML</p>
        </div>
      </FloatChip>

      <FloatChip
        className="right-[6%] bottom-[-6%]"
        floatDuration={6}
        delay={1.05}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-nb-200">
          <Activity className="h-3.5 w-3.5" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-semibold text-white">Line moved</p>
          <p className="text-[10px] text-nb-400">18s ago · BetMGM</p>
        </div>
      </FloatChip>
    </motion.div>
  )
}

function FloatChip({
  children,
  className = '',
  floatDuration = 6,
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  floatDuration?: number
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease, delay }}
      className={`absolute z-10 ${className}`}
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: floatDuration, ease: 'easeInOut', repeat: Infinity, delay }}
        className="inline-flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
