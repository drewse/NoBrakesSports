import Link from 'next/link'
import { ChevronRight, Bookmark } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDateTime } from '@/lib/utils'
import type { WatchlistItem } from '@/types'

interface WatchlistSummaryProps {
  items: WatchlistItem[]
}

export function WatchlistSummary({ items }: WatchlistSummaryProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b border-border pb-4">
        <CardTitle>Watchlist</CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-nb-400 h-7">
          <Link href="/watchlist">
            Manage <ChevronRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center py-8 px-4 text-center">
            <Bookmark className="h-6 w-6 text-nb-600 mb-2" />
            <p className="text-xs text-nb-400">Nothing saved yet</p>
            <Button asChild variant="ghost" size="sm" className="mt-2 text-xs">
              <Link href="/markets">Browse markets</Link>
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {items.slice(0, 5).map((item) => (
              <div key={item.id} className="px-4 py-3 hover:bg-nb-800/40 transition-colors">
                {item.team && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white">{(item as any).team?.name}</span>
                    <Badge variant="muted" className="text-[10px]">Team</Badge>
                  </div>
                )}
                {item.league && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white">{(item as any).league?.name}</span>
                    <Badge variant="muted" className="text-[10px]">League</Badge>
                  </div>
                )}
                {item.event && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-white truncate">{(item as any).event?.title}</span>
                      <Badge variant="muted" className="text-[10px]">Event</Badge>
                    </div>
                    <p className="text-[10px] text-nb-500 mt-0.5">
                      {formatDateTime((item as any).event.start_time)}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
