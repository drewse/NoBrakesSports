'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { League, MarketSource } from '@/types'

interface MarketsFiltersProps {
  leagues: League[]
  sources: MarketSource[]
  currentLeague?: string
  currentSource?: string
  currentType?: string
  currentSearch?: string
}

const MARKET_TYPES = [
  { value: 'moneyline', label: 'Moneyline' },
  { value: 'spread', label: 'Spread' },
  { value: 'total', label: 'Total' },
  { value: 'prop', label: 'Prop' },
  { value: 'futures', label: 'Futures' },
]

export function MarketsFilters({
  leagues, sources, currentLeague, currentSource, currentType,
}: MarketsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const updateFilter = useCallback((key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  const hasFilters = !!(currentLeague || currentSource || currentType)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={currentLeague ?? 'all'} onValueChange={(v) => updateFilter('league', v)}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="All leagues" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All leagues</SelectItem>
          {leagues.map((l) => (
            <SelectItem key={l.id} value={l.id}>{l.abbreviation ?? l.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentSource ?? 'all'} onValueChange={(v) => updateFilter('source', v)}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="All sources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All sources</SelectItem>
          {sources.map((s) => (
            <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentType ?? 'all'} onValueChange={(v) => updateFilter('type', v)}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {MARKET_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-nb-400"
          onClick={() => router.push(pathname)}>
          <X className="h-3 w-3" /> Clear
        </Button>
      )}
    </div>
  )
}
