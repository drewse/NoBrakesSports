import { Badge } from '@/components/ui/badge'

export default function ArbitrageLoading() {
  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 max-w-[1600px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Arbitrage</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">Scanning for opportunities...</p>
      </div>

      {/* Layout: calculator left, opportunities right */}
      <div className="flex gap-5">
        {/* Left: main arb card skeleton */}
        <div className="flex-1 space-y-4">
          <div className="rounded-xl border border-nb-800 bg-nb-900 p-6 space-y-5">
            {/* Badges + profit */}
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <div className="h-5 w-12 rounded bg-nb-800 shimmer" />
                <div className="h-5 w-10 rounded bg-nb-800 shimmer" />
              </div>
              <div className="h-7 w-24 rounded bg-nb-800 shimmer" />
            </div>
            {/* Event title */}
            <div className="h-4 w-64 rounded bg-nb-800 shimmer" />
            {/* Over / Under cards */}
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
            {/* Summary row */}
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

          {/* Stake inputs skeleton */}
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
        <div className="w-[420px] shrink-0 space-y-3">
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
