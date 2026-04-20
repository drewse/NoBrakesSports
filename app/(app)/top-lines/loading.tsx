import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export default function TopEvLinesLoading() {
  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-[1800px]">
      <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:min-h-[calc(100vh-12rem)]">
        {/* Left column: calculator (wide) */}
        <div className="lg:w-[72%] w-full min-w-0 flex-shrink-0 order-2 lg:order-1">
          <div className="hidden lg:block mb-4">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-white">Top EV Lines</h1>
              <Badge variant="pro">PRO</Badge>
            </div>
            <p className="text-xs text-nb-400">Loading opportunities...</p>
          </div>

          {/* Calculator top row: event card / bet card / methods */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-5 space-y-3">
                <div className="h-5 w-16 rounded bg-nb-800 shimmer" />
                <div className="h-4 w-52 rounded bg-nb-800 shimmer" />
                <div className="h-4 w-40 rounded bg-nb-800 shimmer" />
                <div className="h-3 w-28 rounded bg-nb-800/70 shimmer" />
              </CardContent>
            </Card>
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-5 space-y-4 flex flex-col items-center">
                <div className="h-5 w-24 rounded bg-nb-800 shimmer" />
                <div className="h-10 w-28 rounded bg-nb-800 shimmer" />
                <div className="h-3 w-32 rounded bg-nb-800/70 shimmer" />
                <div className="h-8 w-24 rounded bg-nb-800 shimmer" />
              </CardContent>
            </Card>
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-5 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-4">
                    <div className="h-3 w-24 rounded bg-nb-800 shimmer" />
                    <div className="h-3 w-12 rounded bg-nb-800/70 shimmer" />
                    <div className="h-3 w-14 rounded bg-nb-800/70 shimmer" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Profit / Kelly / Fair prob */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="bg-nb-900 border-nb-800">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-24 rounded bg-nb-800 shimmer" />
                    <div className="h-4 w-4 rounded bg-nb-800/70 shimmer" />
                  </div>
                  <div className="h-8 w-32 rounded bg-nb-800 shimmer" />
                  <div className="h-2 w-full rounded bg-nb-800/60 shimmer" />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Books table */}
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="p-0">
              <div className="px-4 py-3 border-b border-nb-800 grid grid-cols-4 gap-4">
                {['Book', 'Odds', 'EV', 'Implied'].map(col => (
                  <div key={col} className="h-3 w-14 rounded bg-nb-800/70 shimmer" />
                ))}
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3 border-b border-border/40 grid grid-cols-4 gap-4">
                  <div className="h-4 w-24 rounded bg-nb-800 shimmer" />
                  <div className="h-4 w-16 rounded bg-nb-800 shimmer" />
                  <div className="h-4 w-16 rounded bg-nb-800 shimmer" />
                  <div className="h-4 w-14 rounded bg-nb-800 shimmer" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column: opportunities feed */}
        <div className="lg:w-[28%] w-full min-w-0 order-1 lg:order-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="h-5 w-28 rounded bg-nb-800 shimmer" />
            <div className="h-3 w-24 rounded bg-nb-800/70 shimmer" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <Card key={i} className="bg-nb-900 border-nb-800">
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-20 rounded bg-nb-800 shimmer" />
                    <div className="h-4 w-6 rounded bg-nb-800/70 shimmer" />
                  </div>
                  <div className="h-3 w-24 rounded bg-nb-800/70 shimmer" />
                  <div className="h-3 w-40 rounded bg-nb-800 shimmer" />
                  <div className="flex items-center justify-between">
                    <div className="h-3 w-12 rounded bg-nb-800/70 shimmer" />
                    <div className="h-3 w-8 rounded bg-nb-800/70 shimmer" />
                    <div className="h-3 w-20 rounded bg-nb-800/70 shimmer" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
