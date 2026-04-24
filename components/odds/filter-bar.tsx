'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { FilterPicker } from './filter-picker'
import {
  LEAGUES_BY_SPORT, MARKETS, STATS_BY_SPORT, PERIODS, MARKETS_WITH_STAT,
  type MarketSelection,
} from '@/lib/odds/market-key'

/**
 * Horizontal pill bar that shows the current Sport → League → Market →
 * [Stat] → Period selection. Click anywhere to open the 5-column picker.
 */
export function FilterBar({ selection }: { selection: MarketSelection }) {
  const [open, setOpen] = useState(false)

  const leagueLabel =
    LEAGUES_BY_SPORT[selection.sport]?.find(l => l.slug === selection.league)?.label
    ?? selection.league.toUpperCase()
  const marketLabel = MARKETS.find(m => m.id === selection.market)?.label ?? selection.market
  const statLabel   = selection.stat
    ? (STATS_BY_SPORT[selection.sport]?.find(s => s.id === selection.stat)?.label ?? selection.stat)
    : null
  const periodLabel = PERIODS.find(p => p.id === selection.period)?.label ?? selection.period
  const showStat = MARKETS_WITH_STAT.has(selection.market) && statLabel

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full max-w-3xl mx-auto flex items-center justify-between gap-2 px-4 py-2 bg-nb-900/60 hover:bg-nb-900 border border-border rounded-full transition-colors"
      >
        <div className="flex items-center gap-2 text-sm">
          <Pill>{leagueLabel}</Pill>
          <Sep />
          <Pill>{marketLabel}</Pill>
          {showStat && <><Sep /><Pill>{statLabel}</Pill></>}
          <Sep />
          <Pill>{periodLabel}</Pill>
        </div>
        <Search className="h-4 w-4 text-nb-500" />
      </button>

      {open && <FilterPicker initial={selection} onClose={() => setOpen(false)} />}
    </>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-white">{children}</span>
}

function Sep() {
  return <span className="text-nb-600">|</span>
}
