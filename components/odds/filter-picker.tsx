'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search, X } from 'lucide-react'
import {
  SPORTS, LEAGUES_BY_SPORT, MARKETS, MARKETS_WITH_STAT, STATS_BY_SPORT, PERIODS,
  type MarketSelection, type SportId, type MarketId, type PeriodId,
  paramsFromSelection,
} from '@/lib/odds/market-key'

/**
 * 5-column hierarchical picker modal: Sport / League / Market / Stat / Period.
 * Matches the AVO / OddsJam pattern. Stat column hides when market is
 * Moneyline or Spread.
 */
export function FilterPicker({
  initial,
  onClose,
}: {
  initial: MarketSelection
  onClose: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [selection, setSelection] = useState<MarketSelection>(initial)
  const [search, setSearch] = useState('')

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const leagues = LEAGUES_BY_SPORT[selection.sport] ?? []
  const stats = STATS_BY_SPORT[selection.sport] ?? []
  const showStat = MARKETS_WITH_STAT.has(selection.market)

  const filter = (s: string) => s.toLowerCase().includes(search.toLowerCase())
  const filteredSports   = useMemo(() => search ? SPORTS.filter(s => filter(s.label)) : SPORTS, [search])
  const filteredLeagues  = useMemo(() => search ? leagues.filter(l => filter(l.label)) : leagues, [leagues, search])
  const filteredMarkets  = useMemo(() => search ? MARKETS.filter(m => filter(m.label)) : MARKETS, [search])
  const filteredStats    = useMemo(() => search ? stats.filter(s => filter(s.label)) : stats, [stats, search])
  const filteredPeriods  = useMemo(() => search ? PERIODS.filter(p => filter(p.label)) : PERIODS, [search])

  // Commit selection → URL
  const apply = (next: MarketSelection) => {
    const params = new URLSearchParams(paramsFromSelection(next))
    router.replace(`${pathname}?${params.toString()}`)
    onClose()
  }

  // Column click handlers — update in-flight selection, don't close yet
  const pickSport = (id: SportId) => {
    const firstLeague = LEAGUES_BY_SPORT[id]?.[0]?.slug ?? ''
    setSelection(s => ({ ...s, sport: id, league: firstLeague, stat: MARKETS_WITH_STAT.has(s.market) ? (STATS_BY_SPORT[id]?.[0]?.id) : undefined }))
  }
  const pickLeague = (slug: string) => setSelection(s => ({ ...s, league: slug }))
  const pickMarket = (id: MarketId) => {
    setSelection(s => ({
      ...s,
      market: id,
      stat: MARKETS_WITH_STAT.has(id) ? (s.stat ?? STATS_BY_SPORT[s.sport]?.[0]?.id) : undefined,
    }))
  }
  const pickStat = (id: string) => setSelection(s => ({ ...s, stat: id }))
  const pickPeriod = (id: PeriodId) => {
    const next = { ...selection, period: id }
    apply(next)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-xl border border-border bg-nb-950 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="relative px-4 py-3 border-b border-border">
          <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-nb-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search for leagues, bet types, stat, etc."
            className="w-full pl-10 pr-10 py-2 bg-nb-900 border border-border rounded-md text-sm text-white placeholder:text-nb-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            autoFocus
          />
          <button
            onClick={onClose}
            className="absolute right-7 top-1/2 -translate-y-1/2 text-nb-500 hover:text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 5-column grid */}
        <div className={`grid ${showStat ? 'grid-cols-5' : 'grid-cols-4'} divide-x divide-border h-[480px]`}>
          <Column
            title="Sport"
            items={filteredSports.map(s => ({ id: s.id, label: s.label }))}
            selected={selection.sport}
            onPick={id => pickSport(id as SportId)}
          />
          <Column
            title="League"
            items={filteredLeagues.map(l => ({ id: l.slug, label: l.label }))}
            selected={selection.league}
            onPick={pickLeague}
          />
          <Column
            title="Market"
            items={filteredMarkets.map(m => ({ id: m.id, label: m.label }))}
            selected={selection.market}
            onPick={id => pickMarket(id as MarketId)}
          />
          {showStat && (
            <Column
              title="Stat"
              items={filteredStats.map(s => ({ id: s.id, label: s.label }))}
              selected={selection.stat ?? ''}
              onPick={pickStat}
            />
          )}
          <Column
            title="Period"
            items={filteredPeriods.map(p => ({ id: p.id, label: p.label }))}
            selected={selection.period}
            onPick={id => pickPeriod(id as PeriodId)}
          />
        </div>
      </div>
    </div>
  )
}

function Column({
  title,
  items,
  selected,
  onPick,
}: {
  title: string
  items: { id: string; label: string }[]
  selected: string
  onPick: (id: string) => void
}) {
  return (
    <div className="flex flex-col overflow-hidden">
      <div className="px-4 py-2 text-[10px] font-semibold text-nb-500 uppercase tracking-wider border-b border-border/50">
        {title}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {items.length === 0 && (
          <div className="px-4 py-3 text-xs text-nb-600 italic">No matches</div>
        )}
        {items.map(item => {
          const isActive = item.id === selected
          return (
            <button
              key={item.id}
              onClick={() => onPick(item.id)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-nb-800 text-white font-medium'
                  : 'text-nb-300 hover:bg-nb-900 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
