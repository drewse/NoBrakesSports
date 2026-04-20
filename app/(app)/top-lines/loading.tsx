import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export default function TopEvLinesLoading() {
  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-5 max-w-[1400px]">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Top EV Lines</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">Loading opportunities...</p>
      </div>

      {/* Filter bar skeleton */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-7 w-28 rounded bg-nb-800 shimmer" />
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-7 w-16 rounded bg-nb-800 shimmer" />
          ))}
        </div>
      </div>

      {/* Podium skeleton */}
      <div className="flex items-end gap-3 mb-5">
        {[16, 24, 10].map((h, i) => (
          <div key={i} className="flex-1 flex flex-col">
            <div className="rounded-xl border border-nb-800 bg-nb-900 p-4 space-y-3">
              <div className="h-3 w-16 rounded bg-nb-800 shimmer" />
              <div className="h-3 w-32 rounded bg-nb-800 shimmer" />
              <div className="h-5 w-20 rounded bg-nb-800 shimmer" />
              <div className="h-4 w-24 rounded bg-nb-800 shimmer" />
            </div>
            <div className={`h-${h} rounded-b-lg bg-nb-900/50 border-x border-b border-nb-800`} />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nb-800">
                  {['Event', 'Market', 'Best Available', 'Books', 'EV %', 'Probability', 'Kelly', 'Updated'].map(col => (
                    <th key={col} className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-4 py-3 min-w-[200px]">
                      <div className="h-3 w-40 rounded bg-nb-800 shimmer mb-1.5" />
                      <div className="h-2.5 w-24 rounded bg-nb-800/60 shimmer" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-2.5 w-14 rounded bg-nb-800 shimmer mb-1.5" />
                      <div className="h-3 w-28 rounded bg-nb-800 shimmer" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="h-4 w-14 rounded bg-nb-800 shimmer" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {Array.from({ length: 3 }).map((_, j) => (
                          <div key={j} className="h-5 w-16 rounded bg-nb-800 shimmer" />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3"><div className="h-3 w-12 rounded bg-nb-800 shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-10 rounded bg-nb-800 shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-8 rounded bg-nb-800 shimmer" /></td>
                    <td className="px-4 py-3"><div className="h-3 w-14 rounded bg-nb-800 shimmer" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
