import Link from 'next/link'
import { ArrowUpRight, ArrowDownRight, Minus, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProGate } from '@/components/shared/pro-gate'
import { formatDateTime } from '@/lib/utils'
import type { Event } from '@/types'

interface DashboardMarketTableProps {
  events: Event[]
  isPro: boolean
}

export function DashboardMarketTable({ events, isPro }: DashboardMarketTableProps) {
  const visibleEvents = isPro ? events : events.slice(0, 5)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b border-border pb-4">
        <CardTitle>Upcoming Events</CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-nb-400 h-7">
          <Link href="/markets">
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ProGate isPro={isPro} featureName="Full market table" blur={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Event</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">League</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Start</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleEvents.map((event) => (
                  <tr key={event.id} className="border-b border-border/50 hover:bg-nb-800/40 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/markets?event=${event.id}`} className="text-sm font-medium text-white hover:underline">
                        {event.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="muted" className="text-[10px]">
                        {(event.league as any)?.abbreviation ?? '—'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-nb-400 font-mono">
                      {formatDateTime(event.start_time)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant={event.status === 'live' ? 'live' : 'muted'} className="text-[10px]">
                        {event.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {visibleEvents.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-nb-400">
                      No upcoming events
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ProGate>

        {!isPro && events.length > 5 && (
          <div className="px-4 py-3 border-t border-border text-center">
            <p className="text-xs text-nb-400">
              {events.length - 5} more events available with{' '}
              <Link href="/account/billing" className="text-white underline">Pro</Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
