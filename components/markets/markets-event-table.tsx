'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, formatRelativeTime } from '@/lib/utils'

export interface EventSummary {
  id: string
  title: string
  start_time: string
  league: { name: string; abbreviation: string | null; slug: string } | null
  league_id: string
  sourceCount: number
  marketTypes: string[]
  lastUpdated: string | null
}

interface MarketsEventTableProps {
  events: EventSummary[]
  isPro: boolean
}

type SortKey = 'title' | 'start_time' | 'sourceCount' | 'lastUpdated'

const MARKET_TYPE_LABELS: Record<string, string> = {
  moneyline: 'ML',
  spread: 'Spread',
  total: 'Total',
  prop: 'Prop',
  futures: 'Futures',
}

export function MarketsEventTable({ events, isPro }: MarketsEventTableProps) {
  const router = useRouter()
  const [sortKey, setSortKey] = useState<SortKey>('start_time')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const pageSize = 20

  const sorted = useMemo(() => {
    return [...events].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'title') cmp = a.title.localeCompare(b.title)
      else if (sortKey === 'start_time') cmp = a.start_time.localeCompare(b.start_time)
      else if (sortKey === 'sourceCount') cmp = a.sourceCount - b.sourceCount
      else if (sortKey === 'lastUpdated') {
        cmp = (a.lastUpdated ?? '').localeCompare(b.lastUpdated ?? '')
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [events, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function SortBtn({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k
    return (
      <button
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider hover:text-white transition-colors"
        style={{ color: active ? 'white' : undefined }}
        onClick={() => toggleSort(k)}
      >
        <span className={active ? 'text-white' : 'text-nb-400'}>{label}</span>
        {active
          ? sortDir === 'asc'
            ? <ArrowUp className="h-3 w-3 text-white" />
            : <ArrowDown className="h-3 w-3 text-white" />
          : <ArrowUpDown className="h-3 w-3 text-nb-500" />
        }
      </button>
    )
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-nb-900/60">
              <th className="px-4 py-2.5 text-left w-[40%]">
                <SortBtn label="Event" k="title" />
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                League
              </th>
              <th className="px-4 py-2.5 text-left">
                <SortBtn label="Start Time" k="start_time" />
              </th>
              <th className="px-4 py-2.5 text-left">
                <SortBtn label="Sources" k="sourceCount" />
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                Markets
              </th>
              <th className="px-4 py-2.5 text-left">
                <SortBtn label="Updated" k="lastUpdated" />
              </th>
              <th className="px-4 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((event) => (
              <tr
                key={event.id}
                className="border-b border-border/50 hover:bg-nb-800/30 transition-colors cursor-pointer group"
                onClick={() => router.push(`/markets/${event.id}`)}
              >
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-white group-hover:text-nb-200 transition-colors leading-snug">
                    {event.title}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {event.league ? (
                    <Badge variant="muted" className="text-[10px] whitespace-nowrap">
                      {event.league.abbreviation ?? event.league.name}
                    </Badge>
                  ) : (
                    <span className="text-xs text-nb-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs text-nb-300 font-mono">
                    {formatDateTime(event.start_time)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {event.sourceCount > 0 ? (
                    <span className="text-xs text-nb-300 whitespace-nowrap">
                      {event.sourceCount} source{event.sourceCount !== 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className="text-xs text-nb-600">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {event.marketTypes.length > 0
                      ? event.marketTypes.map(t => (
                          <Badge key={t} variant="muted" className="text-[10px] capitalize">
                            {MARKET_TYPE_LABELS[t] ?? t}
                          </Badge>
                        ))
                      : <span className="text-xs text-nb-600">—</span>
                    }
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-[10px] text-nb-500 font-mono">
                    {event.lastUpdated ? formatRelativeTime(event.lastUpdated) : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <ChevronRight className="h-4 w-4 text-nb-600 group-hover:text-nb-300 transition-colors" />
                </td>
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-nb-400">
                  No events found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-nb-900/30">
        <p className="text-xs text-nb-400">
          {sorted.length} events{!isPro && ' · Upgrade Pro for full access'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Prev
          </Button>
          <span className="text-xs text-nb-400">{page + 1} / {pageCount}</span>
          <Button
            variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
