import { Badge } from '@/components/ui/badge'

/**
 * Layout-matching skeleton for the Arb page. Used by both
 * `app/(app)/arbitrage/loading.tsx` (route transition) and the
 * page-level <Suspense> fallback. Shape mirrors ArbCalculatorClient
 * so there's no layout shift when real data arrives.
 *
 * Animation: subtle pulse via Tailwind's `animate-pulse` plus a
 * `shimmer` variant defined in globals.css. Dark futuristic palette
 * matches the rest of the app.
 */
export function ArbSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Arbitrage</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">Scanning for opportunities…</p>
      </div>

      {/* Layout: calculator left, opportunities right */}
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-5">
        {/* Left: main arb card skeleton */}
        <div className="flex-1 space-y-4 min-w-0">
          <div className="rounded-xl border border-nb-800 bg-nb-900 p-4 sm:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <div className="h-5 w-12 rounded bg-nb-800 shimmer" />
                <div className="h-5 w-10 rounded bg-nb-800 shimmer" />
              </div>
              <div className="h-7 w-24 rounded bg-nb-800 shimmer" />
            </div>
            <div className="h-4 w-64 max-w-full rounded bg-nb-800 shimmer" />
            <div className="grid grid-cols-2 gap-4">
              {[0, 1].map(i => (
                <div key={i} className="rounded-lg border border-nb-800 bg-nb-850 p-5 space-y-3">
                  <div className="flex justify-between">
                    <div className="h-3 w-10 rounded bg-nb-800 shimmer" />
                    <div className="h-3 w-16 rounded bg-nb-800 shimmer" />
                  </div>
                  <div className="h-8 w-20 mx-auto rounded bg-nb-800 shimmer" />
                  <div className="flex justify-between">
                    <div className="h-3 w-14 rounded bg-nb-800 shimmer" />
                    <div className="h-3 w-14 rounded bg-nb-800 shimmer" />
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-nb-800 bg-nb-850 p-4">
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="text-center space-y-2">
                    <div className="h-2.5 w-20 mx-auto rounded bg-nb-800 shimmer" />
                    <div className="h-5 w-16 mx-auto rounded bg-nb-800 shimmer" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-nb-800 bg-nb-900 p-4">
            <div className="grid grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-2.5 w-20 rounded bg-nb-800 shimmer" />
                  <div className="h-8 rounded bg-nb-800 shimmer" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: opportunities list skeleton */}
        <div className="lg:w-[420px] w-full shrink-0 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <div className="h-4 w-28 rounded bg-nb-800 shimmer" />
            <div className="h-3 w-36 rounded bg-nb-800 shimmer" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-nb-800 bg-nb-900 p-4 space-y-2">
              <div className="flex justify-between">
                <div className="flex gap-2">
                  <div className="h-5 w-12 rounded bg-nb-800 shimmer" />
                  <div className="h-5 w-10 rounded bg-nb-800 shimmer" />
                </div>
                <div className="h-5 w-16 rounded bg-nb-800 shimmer" />
              </div>
              <div className="h-3 w-48 rounded bg-nb-800 shimmer" />
              <div className="h-2.5 w-56 rounded bg-nb-800/60 shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
