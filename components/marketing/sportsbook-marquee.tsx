'use client'

import { BookLogo } from '@/components/shared/book-logo'

/**
 * Marketing-page sportsbook marquee. A horizontal infinite-scroll strip
 * of supported books, sitting directly below the hero with a soft fade
 * into the page background. Pure CSS animation (keyframes in
 * globals.css) — pauses on hover, edges masked with a left/right fade.
 *
 * The list is rendered twice in-line so a -50% translate produces a
 * seamless loop. Each item uses BookLogo when we have a known slug,
 * otherwise falls back to a plain text chip.
 */

interface BookItem {
  /** Display name shown alongside (or in place of) the logo. */
  name: string
  /** book-logo slug — must match a key in components/shared/book-logo.tsx
   *  for a real PNG to render. Omit to render text-only. */
  slug?: string
}

const BOOKS: BookItem[] = [
  { name: 'FanDuel',            slug: 'fanduel' },
  { name: 'DraftKings',         slug: 'draftkings' },
  { name: 'BetMGM',             slug: 'betmgm' },
  { name: 'Caesars',            slug: 'caesars' },
  { name: 'Fanatics' },
  { name: 'BetRivers',          slug: 'betrivers' },
  { name: 'ESPN BET' },
  { name: 'Hard Rock Bet' },
  { name: 'PointsBet',          slug: 'pointsbet_on' },
  { name: 'bet365',             slug: 'bet365' },
  { name: 'NorthStar Bets',     slug: 'northstarbets' },
  { name: 'theScore Bet',       slug: 'thescore' },
  { name: 'Bally Bet',          slug: 'ballybet' },
  { name: 'Betway',             slug: 'betway' },
  { name: 'Pinnacle',           slug: 'pinnacle' },
  { name: 'Sports Interaction', slug: 'sports_interaction' },
  { name: 'BetVictor',          slug: 'betvictor' },
  { name: 'Betano',             slug: 'betano' },
  { name: 'PROLINE+',           slug: 'proline' },
  { name: 'PlayNow' },
  { name: 'Loto-Québec',        slug: 'miseojeu' },
  { name: 'Bet99',              slug: 'bet99' },
  { name: 'PowerPlay',          slug: 'powerplay' },
  { name: 'Bodog' },
]

export function SportsbookMarquee() {
  return (
    <section className="relative overflow-hidden">
      {/* Top fade so this section blends out of the hero rather than
       *  starting on a visible seam. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 z-10"
        style={{ background: 'linear-gradient(to bottom, rgba(10,10,10,0.9), transparent)' }}
        aria-hidden
      />

      <div className="relative mx-auto w-full max-w-6xl px-4 sm:px-6 pt-12 sm:pt-16 pb-14 sm:pb-20">
        <h2 className="text-center text-2xl sm:text-3xl font-bold tracking-tight text-white/80">
          Supports 50+ North American Sportsbooks
        </h2>

        {/* Marquee — gradient mask handles the left/right fade. */}
        <div
          className="group relative mt-10 sm:mt-12"
          style={{
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0, black 80px, black calc(100% - 80px), transparent 100%)',
            maskImage:
              'linear-gradient(to right, transparent 0, black 80px, black calc(100% - 80px), transparent 100%)',
          }}
        >
          <div className="marquee-track flex w-max items-center gap-12 sm:gap-14">
            {/* Track A */}
            <MarqueeRow books={BOOKS} />
            {/* Track B — duplicate, aria-hidden so SR doesn't read twice */}
            <MarqueeRow books={BOOKS} ariaHidden />
          </div>
        </div>
      </div>
    </section>
  )
}

function MarqueeRow({ books, ariaHidden = false }: { books: BookItem[]; ariaHidden?: boolean }) {
  return (
    <ul
      className="flex shrink-0 items-center gap-10 sm:gap-12"
      aria-hidden={ariaHidden || undefined}
    >
      {books.map((b, i) => (
        <li key={`${b.name}-${i}`} className="shrink-0">
          <span className="inline-flex items-center gap-2.5 text-sm sm:text-base font-medium text-nb-500 hover:text-white transition-colors duration-200 whitespace-nowrap">
            {b.slug && (
              <span className="opacity-90 group-hover:opacity-100">
                <BookLogo name={b.slug} size="sm" />
              </span>
            )}
            <span>{b.name}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
