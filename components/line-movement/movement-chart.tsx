'use client'

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { format, parseISO } from 'date-fns'
import { formatOdds } from '@/lib/utils'

interface MovementChartProps {
  event: { title: string; start_time: string; league?: { abbreviation?: string } } | null
  snapshots: Array<{
    id: string
    home_price: number | null
    away_price: number | null
    snapshot_time: string
    market_type: string
  }>
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded border border-border bg-nb-900 px-3 py-2 shadow-lg text-xs">
      <p className="text-nb-400 mb-1">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="font-mono text-white">
          {entry.name}: {formatOdds(entry.value)}
        </p>
      ))}
    </div>
  )
}

export function MovementChart({ event, snapshots }: MovementChartProps) {
  const chartData = snapshots
    .filter((s) => s.market_type === 'spread' && s.home_price != null)
    .sort((a, b) => new Date(a.snapshot_time).getTime() - new Date(b.snapshot_time).getTime())
    .slice(-48)
    .map((s) => ({
      time: format(parseISO(s.snapshot_time), 'MMM d HH:mm'),
      home: s.home_price,
      away: s.away_price,
    }))

  return (
    <Card>
      <CardHeader className="border-b border-border pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{event?.title ?? 'Event'}</CardTitle>
            {event?.league?.abbreviation && (
              <Badge variant="muted" className="mt-1.5 text-[10px]">{event.league.abbreviation}</Badge>
            )}
          </div>
          <span className="text-xs text-nb-400">Spread line · Last 48 snapshots</span>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {chartData.length < 2 ? (
          <div className="flex items-center justify-center h-44 text-sm text-nb-400">
            Not enough movement data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#555' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#555', fontFamily: 'monospace' }} tickLine={false} axisLine={false} tickFormatter={(v) => formatOdds(v)} width={46} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="home" name="Home" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: '#fff' }} />
              <Line type="monotone" dataKey="away" name="Away" stroke="rgba(255,255,255,0.3)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: '#888' }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
