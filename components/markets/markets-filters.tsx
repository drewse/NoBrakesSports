'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useState, useEffect } from 'react'
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
  leagues, sources, currentLeague, currentSource, currentType, currentSearch,
}: MarketsFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchValue, setSearchValue] = useState(currentSearch ?? '')

  useEffect(() => { setSearchValue(currentSearch ?? '') }, [currentSearch])

  const updateFilter = useCallback((key: string, value: string | undefined) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }, [router, pathname, searchParams])

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (searchValue.trim()) params.set('q', searchValue.trim())
    else params.delete('q')
    router.push(`${pathname}?${params.toString()}`)
  }

  const hasFilters = !!(currentLeague || currentSource || currentType || currentSearch)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form onSubmit={handleSearch} className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-nb-500 pointer-events-none" />
        <Input
          value={searchValue}
          onChange={e => setSearchValue(e.target.value)}
          placeholder="Search events…"
          className="h-8 w-52 pl-8 text-xs"
        />
      </form>

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

      {sources.length > 0 && (
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
      )}

      {sources.length > 0 && (
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
      )}

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 text-xs text-nb-400"
          onClick={() => { setSearchValue(''); router.push(pathname) }}>
          <X className="h-3 w-3 mr-1" />Clear
        </Button>
      )}
    </div>
  )
}
