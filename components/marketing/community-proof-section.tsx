'use client'

import Link from 'next/link'
import { BadgeCheck, MessageCircle, TrendingUp, ArrowRight } from 'lucide-react'

/**
 * "Trusted By Profitable Bettors Everywhere" — community-proof section
 * with a heading, Discord CTA, and an infinite-scroll marquee of fake
 * review cards. Pure CSS animation (keyframes in globals.css), pause
 * on hover, edges masked to fade.
 *
 * Discord invite is a placeholder href until DISCORD_INVITE_URL is
 * wired up.
 */

const DISCORD_INVITE_URL = '#'

interface Review {
  name: string
  handle?: string
  /** Profit / activity stat shown in the colored chip. */
  result: string
  /** 'profit' = green tint, 'info' = violet tint. */
  tint: 'profit' | 'info'
  text: string
}

const REVIEWS: Review[] = [
  {
    name: 'DK',
    handle: '@dkpicks',
    result: '+$742 this month',
    tint: 'profit',
    text: 'No Brakes helped me find plays I would have missed. The live odds and EV alerts make it way easier to move fast.',
  },
  {
    name: 'Jordan',
    handle: '@jordan_bets',
    result: '+18.4% EV hit',
    tint: 'profit',
    text: 'The dashboard is clean and the sportsbook comparisons save me so much time.',
  },
  {
    name: 'Marcus',
    handle: '@marcusm',
    result: '+$1,230 tracked',
    tint: 'profit',
    text: 'Finally a tool that shows the best prices without making me jump between ten apps.',
  },
  {
    name: 'Ryan',
    handle: '@ryan_action',
    result: '42 alerts followed',
    tint: 'info',
    text: 'The line movement alerts are the best part. I can see where the market is moving before I place anything.',
  },
  {
    name: 'Alex',
    handle: '@alxsports',
    result: '+$386 week',
    tint: 'profit',
    text: 'The arb alerts alone make this worth checking every day.',
  },
  {
    name: 'Sam',
    handle: '@samonline',
    result: '15 sportsbooks compared',
    tint: 'info',
    text: 'No Brakes makes the whole process feel organized instead of chaotic.',
  },
]

/** Stable hue per name so the avatar circle gets a consistent color. */
function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
  return `hsl(${h}, 65%, 55%)`
}

export function CommunityProofSection() {
  return (
    <section
      aria-labelledby="community-proof-heading"
      className="relative overflow-hidden"
    >
      {/* Subtle radial glow behind the heading */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-[460px] w-[1100px] -translate-x-1/2 rounded-full opacity-50 blur-[140px]"
        style={{
          background:
            'radial-gradient(closest-side at 35% 50%, rgba(34,197,94,0.16), transparent 70%), ' +
            'radial-gradient(closest-side at 65% 50%, rgba(168,85,247,0.16), transparent 70%)',
        }}
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-[1440px] px-6 sm:px-8 lg:px-12 xl:px-16 pt-16 sm:pt-20 lg:pt-24 pb-6 sm:pb-8">
        <h2
          id="community-proof-heading"
          className="text-center text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-white"
        >
          Trusted By Profitable Bettors Everywhere
        </h2>
        <p className="mx-auto mt-4 sm:mt-5 max-w-2xl text-center text-sm sm:text-base text-nb-300 leading-relaxed">
          Join the No Brakes community for free live +EV alerts, market
          updates, and support from bettors using the platform every day.
        </p>

        <div className="mt-7 sm:mt-8 flex justify-center">
          <Link
            href={DISCORD_INVITE_URL}
            aria-label="Join the No Brakes Sports Discord community"
            className="inline-flex h-12 items-center gap-2.5 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] px-6 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(88,101,242,0.35)] hover:shadow-[0_8px_40px_rgba(88,101,242,0.5)] transition-all hover:scale-[1.03] active:scale-[0.98]"
          >
            <MessageCircle className="h-4 w-4" />
            Join the Discord
            <ArrowRight className="h-4 w-4 opacity-80" />
          </Link>
        </div>
      </div>

      {/* Marquee — full-viewport-width, edge-masked. Lives outside the
       *  max-w container so it bleeds to the screen edges like AVO. */}
      <div
        className="group relative mt-10 sm:mt-12 pb-16 sm:pb-24 w-full overflow-hidden"
        style={{
          WebkitMaskImage:
            'linear-gradient(to right, transparent 0, black 80px, black calc(100% - 80px), transparent 100%)',
          maskImage:
            'linear-gradient(to right, transparent 0, black 80px, black calc(100% - 80px), transparent 100%)',
        }}
      >
        <div className="marquee-reviews-track flex w-max items-stretch gap-5 sm:gap-6 lg:gap-8">
          {/* Track A */}
          <ReviewRow reviews={REVIEWS} />
          {/* Track B — duplicate for seamless loop */}
          <ReviewRow reviews={REVIEWS} ariaHidden />
        </div>
      </div>
    </section>
  )
}

function ReviewRow({ reviews, ariaHidden = false }: { reviews: Review[]; ariaHidden?: boolean }) {
  return (
    <ul
      className="flex shrink-0 items-stretch gap-5 sm:gap-6 lg:gap-8"
      aria-hidden={ariaHidden || undefined}
    >
      {reviews.map((r, i) => (
        <li key={`${r.name}-${i}`} className="shrink-0">
          <ReviewCard review={r} />
        </li>
      ))}
    </ul>
  )
}

function ReviewCard({ review }: { review: Review }) {
  const tintCls = review.tint === 'profit'
    ? 'bg-green-500/10 text-green-400 border-green-500/20'
    : 'bg-violet-500/10 text-violet-300 border-violet-500/20'
  const Icon = review.tint === 'profit' ? TrendingUp : BadgeCheck

  return (
    <article className="flex h-full w-[280px] sm:w-[340px] lg:w-[400px] flex-col justify-between gap-5 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6 backdrop-blur-xl shadow-2xl">
      {/* Header: avatar + name + verified + platform */}
      <header className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={{ background: avatarColor(review.name) }}
          aria-hidden
        >
          {review.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-white truncate">{review.name}</p>
            <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-sky-400" aria-label="Verified" />
          </div>
          {review.handle && (
            <p className="text-[11px] text-nb-500 truncate">{review.handle}</p>
          )}
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-[#5865F2]/15 px-2 py-1 text-[10px] font-semibold text-[#a3aff7]">
          <MessageCircle className="h-3 w-3" />
          Discord
        </span>
      </header>

      {/* Profit / activity stat chip */}
      <div className={`inline-flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1 text-xs font-semibold ${tintCls}`}>
        <Icon className="h-3.5 w-3.5" />
        {review.result}
      </div>

      {/* Body */}
      <p className="text-sm leading-relaxed text-nb-200">
        &ldquo;{review.text}&rdquo;
      </p>
    </article>
  )
}
