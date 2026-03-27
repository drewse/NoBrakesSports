import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatOdds, formatRelativeTime, formatSpread } from '@/lib/utils'
import type { MarketSnapshot } from '@/types'

interface Mover {
  eventId: string
  event: { title: string; start_time: string; league?: { abbreviation?: string } } | null
  maxMagnitude: number
  latestSnap: MarketSnapshot
}

export function LineMovementTable({ movers }: { movers: Mover[] }) {
  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <CardTitle>Biggest Movers</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Event', 'League', 'Current Line', 'Direction', 'Magnitude', 'Updated'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movers.map((mover) => {
                const snap = mover.latestSnap
                const dir = snap.movement_direction
                return (
                  <tr key={mover.eventId} className="border-b border-border/50 hover:bg-nb-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-white">{mover.event?.title ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="muted" className="text-[10px]">
                        {mover.event?.league?.abbreviation ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-white">
                        {snap.market_type === 'spread'
                          ? `${formatSpread(snap.spread_value)} (${formatOdds(snap.home_price)})`
                          : formatOdds(snap.home_price)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {dir === 'up' && <TrendingUp className="h-3.5 w-3.5 text-white" />}
                        {dir === 'down' && <TrendingDown className="h-3.5 w-3.5 text-nb-300" />}
                        {dir === 'flat' && <Minus className="h-3.5 w-3.5 text-nb-600" />}
                        <span className={`text-xs capitalize ${dir === 'up' ? 'text-white' : dir === 'down' ? 'text-nb-300' : 'text-nb-600'}`}>
                          {dir}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-mono font-semibold ${mover.maxMagnitude >= 3 ? 'text-white' : 'text-nb-300'}`}>
                        {mover.maxMagnitude.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] text-nb-500 font-mono">
                        {formatRelativeTime(snap.snapshot_time)}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {movers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-nb-400">
                    No movement data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
