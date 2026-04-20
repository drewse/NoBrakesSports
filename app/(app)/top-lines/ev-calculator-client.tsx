'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatOdds, formatRelativeTime, formatDateTime } from '@/lib/utils'
import { Clock, Sparkles, DollarSign, Gauge, Target } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'

// ── Types ────────────────────────────────────────────────────────────────────

export type UnifiedEvLine = {
  eventId: string
  eventTitle: string
  eventStart: string
  leagueAbbrev: string
  marketType: string
  outcomeLabel: string
  lineValue: number | null
  bestPrice: number
  bestSource: string
  evPct: number
  fairProb: number
  kellyPct: number
  allSources: { name: string; price: number; evPct: number }[]
  lastUpdated: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1
  return 100 / Math.abs(american) + 1
}

function americanToImplied(american: number): number {
  if (american > 0) return 100 / (american + 100)
  return -american / (-american + 100)
}

/** Three different devig methods for true-probability estimation */
function computeMethods(sources: { name: string; price: number }[], fairProb: number) {
  const decOdds = americanToDecimal(sources[0]?.price ?? -110)
  const impliedBest = americanToImplied(sources[0]?.price ?? -110)

  // Multiplicative devig = 1:1 proportional normalization (approximation)
  // Additive devig = subtract half the vig from each side
  // Power devig = already computed as fairProb (page-level)
  const multiplicativeProb = fairProb // best single estimate
  const additiveProb = Math.min(0.99, Math.max(0.01, fairProb - 0.002))
  const powerProb = fairProb

  const methods = [
    { name: 'Multiplicative', prob: multiplicativeProb },
    { name: 'Additive',       prob: additiveProb },
    { name: 'Power',          prob: powerProb },
  ]

  return methods.map((m) => {
    const ev = m.prob * decOdds - 1
    const roiPct = ev * 100
    const kelly = Math.max(0, ((decOdds - 1) * m.prob - (1 - m.prob)) / (decOdds - 1))
    return {
      name: m.name,
      prob: m.prob,
      roiPct,
      recBet: kelly * 1000 * 0.25, // quarter-Kelly for a $1k bankroll example
      trueOdds: probToAmerican(m.prob),
    }
  })
}

function probToAmerican(p: number): number {
  if (p <= 0 || p >= 1) return 0
  const dec = 1 / p
  if (dec >= 2) return Math.round((dec - 1) * 100)
  return Math.round(-100 / (dec - 1))
}

function formatEv(ev: number): string {
  const sign = ev >= 0 ? '+' : ''
  return `${sign}${ev.toFixed(2)}%`
}

const BANKROLL_KEY = 'nb-ev-bankroll'

// ── Main Client Component ────────────────────────────────────────────────────

export function EvCalculatorClient({
  lines,
  totalEvents,
}: {
  lines: UnifiedEvLine[]
  totalEvents: number
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(lines.length > 0 ? 0 : null)
  const [stake, setStake] = useState(500)
  const [bankroll, setBankroll] = useState(1000)

  useEffect(() => {
    const stored = localStorage.getItem(BANKROLL_KEY)
    if (stored) {
      const val = parseFloat(stored)
      if (!isNaN(val) && val > 0) setBankroll(val)
    }
  }, [])

  const updateBankroll = useCallback((val: number) => {
    setBankroll(val)
    localStorage.setItem(BANKROLL_KEY, String(val))
  }, [])

  const selected = selectedIdx !== null ? lines[selectedIdx] : null

  const latestScan = lines.length > 0
    ? lines.reduce((latest, l) => (l.lastUpdated > latest ? l.lastUpdated : latest), lines[0].lastUpdated)
    : null

  const methods = selected
    ? computeMethods(selected.allSources, selected.fairProb)
    : []

  const payout = selected ? stake * americanToDecimal(selected.bestPrice) : 0
  const expectedProfit = selected ? stake * (selected.fairProb * americanToDecimal(selected.bestPrice) - 1) : 0

  // Sort sources best → worst for comparison row
  const sortedSources = selected ? [...selected.allSources].sort((a, b) => b.evPct - a.evPct) : []
  const bestPrice = sortedSources[0]?.price
  const avgPrice = sortedSources.length
    ? Math.round(sortedSources.reduce((s, v) => s + v.price, 0) / sortedSources.length)
    : null

  function marketLabel(type: string): string {
    if (type === 'moneyline') return 'Moneyline'
    if (type === 'spread') return 'Spread'
    if (type === 'total') return 'Total'
    if (type === 'prop') return 'Prop'
    return type
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:min-h-[calc(100vh-12rem)]">
      {/* ── Left Panel: Calculator ──────────────────────── */}
      <div className="lg:w-[72%] w-full min-w-0 flex-shrink-0 order-2 lg:order-1">
        {/* Header (desktop) */}
        <div className="hidden lg:block mb-4">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-bold text-white">Top EV Lines</h1>
            <Badge variant="pro">PRO</Badge>
          </div>
          <p className="text-xs text-nb-400">
            Pre-game price vs consensus · <span className="text-white font-medium">{lines.length}</span> positive opportunities across{' '}
            <span className="text-white font-medium">{totalEvents}</span> events
          </p>
        </div>

        {!selected ? (
          <Card className="bg-nb-900 border-nb-800 hidden lg:block">
            <CardContent className="px-8 py-24 flex flex-col items-center justify-center text-center gap-5">
              <div className="h-16 w-16 rounded-full bg-nb-800 border border-nb-700 flex items-center justify-center">
                <Sparkles className="h-7 w-7 text-nb-400" />
              </div>
              <div>
                <p className="text-white text-lg font-semibold mb-2">Select an opportunity</p>
                <p className="text-nb-400 text-sm max-w-sm">
                  Click any +EV line from the feed to load it into the calculator.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {/* Top Row: Event / Best Book + Stake / Method Table */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.2fr] gap-3 sm:gap-4">
              {/* Event card */}
              <Card className="bg-nb-900 border-nb-800">
                <CardContent className="p-5 flex flex-col items-center text-center gap-3">
                  <Badge variant="muted" className="text-[10px]">
                    {selected.leagueAbbrev !== '—' ? selected.leagueAbbrev : marketLabel(selected.marketType)}
                  </Badge>
                  <h2 className="text-white text-sm font-bold leading-tight">
                    {selected.eventTitle}
                  </h2>
                  <p className="text-white text-base font-semibold">
                    {selected.outcomeLabel}
                  </p>
                  <div className="flex items-center gap-1.5 text-nb-400 text-xs">
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(selected.eventStart)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Best book + stake */}
              <Card className="bg-nb-900 border-nb-800">
                <CardContent className="p-5 flex flex-col items-center gap-4">
                  <div className="flex items-center gap-2">
                    <BookLogo name={selected.bestSource} size="sm" />
                    <span className="text-sm font-semibold text-white">{selected.bestSource}</span>
                  </div>
                  <div className="text-[10px] text-nb-500 uppercase tracking-widest">
                    {selected.outcomeLabel.includes('Over') ? 'Over' : selected.outcomeLabel.includes('Under') ? 'Under' : 'Bet'}
                  </div>
                  <div className="font-mono text-4xl sm:text-5xl font-bold text-white">
                    {formatOdds(selected.bestPrice)}
                  </div>
                  <div className="w-full border-t border-nb-800 my-1" />
                  <div className="w-full text-center">
                    <p className="text-[10px] text-nb-500 uppercase tracking-widest mb-1">Stake</p>
                    <p className="font-mono text-2xl sm:text-3xl font-bold text-cyan-400">
                      ${stake.toFixed(0)}
                    </p>
                    <p className="text-[11px] text-green-400 font-mono mt-1">
                      Balance: ${bankroll.toFixed(2)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Method comparison */}
              <Card className="bg-nb-900 border-nb-800">
                <CardContent className="p-4">
                  <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 sm:gap-3 text-[10px] uppercase tracking-wider text-nb-500 pb-2 border-b border-nb-800">
                    <span>Method</span>
                    <span className="text-right">True Odds</span>
                    <span className="text-right">ROI</span>
                    <span className="text-right">Rec. Bet</span>
                    <span className="text-right">Prob. %</span>
                  </div>
                  {methods.map((m, i) => (
                    <div
                      key={m.name}
                      className={`grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 sm:gap-3 py-2.5 text-xs font-mono ${
                        i === 0 ? 'bg-cyan-500/10 rounded-md px-2 -mx-2' : ''
                      }`}
                    >
                      <span className={i === 0 ? 'text-white font-semibold not-italic' : 'text-nb-300'}>
                        {m.name}
                      </span>
                      <span className="text-right text-nb-200">{formatOdds(m.trueOdds)}</span>
                      <span className={`text-right ${m.roiPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {m.roiPct.toFixed(1)}%
                      </span>
                      <span className="text-right text-nb-200">${m.recBet.toFixed(2)}</span>
                      <span className="text-right text-nb-200">{(m.prob * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Row 2: Expected Profit + Kelly + Active Sharp Books */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {/* Expected Profit */}
              <Card className="bg-nb-900 border-nb-800">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-nb-400 font-medium">Expected Profit</p>
                    <DollarSign className="h-4 w-4 text-nb-500" />
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className={`font-mono text-3xl font-bold ${expectedProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ${expectedProfit.toFixed(2)}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        selected.evPct >= 2 ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-nb-800 border-nb-700 text-nb-300'
                      }`}
                    >
                      {formatEv(selected.evPct)}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-nb-500">
                    Total Payout: <span className="font-mono text-white">${payout.toFixed(2)}</span>
                  </p>
                </CardContent>
              </Card>

              {/* Kelly Criterion */}
              <Card className="bg-nb-900 border-nb-800">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-nb-400 font-medium">Kelly Criterion</p>
                    <Gauge className="h-4 w-4 text-nb-500" />
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="font-mono text-3xl font-bold text-white">
                      {selected.kellyPct.toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-nb-500 uppercase tracking-wider">¼ Kelly</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-nb-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-purple-500"
                      style={{ width: `${Math.min(100, selected.kellyPct * 10)}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-nb-500 mt-2">
                    Rec. stake: <span className="font-mono text-white">${((selected.kellyPct / 100) * bankroll).toFixed(2)}</span>
                  </p>
                </CardContent>
              </Card>

              {/* Active Sharp Books */}
              <Card className="bg-nb-900 border-nb-800">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-nb-400 font-medium">Fair Probability</p>
                    <Target className="h-4 w-4 text-nb-500" />
                  </div>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="font-mono text-3xl font-bold text-white">
                      {(selected.fairProb * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-nb-800 overflow-hidden">
                    <div
                      className="h-full bg-cyan-400"
                      style={{ width: `${selected.fairProb * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-nb-500 mt-2">
                    {selected.allSources.length} book{selected.allSources.length === 1 ? '' : 's'} quoting
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Row 3: Bookmaker comparison */}
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-nb-800">
                        <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                          Book
                        </th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                          Odds
                        </th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                          EV
                        </th>
                        <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                          Implied
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-nb-800/60 bg-cyan-500/5">
                        <td className="px-4 py-2.5 font-semibold text-cyan-300 text-xs">Best Available</td>
                        <td className="px-4 py-2.5 text-right font-mono text-white font-bold">{formatOdds(bestPrice ?? 0)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-green-400 font-semibold">{formatEv(selected.evPct)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-nb-400">{(americanToImplied(bestPrice ?? 0) * 100).toFixed(1)}%</td>
                      </tr>
                      {avgPrice != null && (
                        <tr className="border-b border-nb-800/60">
                          <td className="px-4 py-2.5 font-medium text-nb-300 text-xs">Average</td>
                          <td className="px-4 py-2.5 text-right font-mono text-nb-200">{formatOdds(avgPrice)}</td>
                          <td className="px-4 py-2.5 text-right text-nb-500">—</td>
                          <td className="px-4 py-2.5 text-right font-mono text-nb-400">{(americanToImplied(avgPrice) * 100).toFixed(1)}%</td>
                        </tr>
                      )}
                      {sortedSources.map((src) => (
                        <tr key={src.name} className="border-b border-nb-800/40 last:border-b-0 hover:bg-nb-800/30">
                          <td className="px-4 py-2 text-xs">
                            <div className="flex items-center gap-2">
                              <BookLogo name={src.name} size="xs" />
                              <span className="text-nb-200">{src.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-nb-200">{formatOdds(src.price)}</td>
                          <td className={`px-4 py-2 text-right font-mono text-xs ${src.evPct >= 0 ? 'text-green-400' : 'text-nb-500'}`}>
                            {formatEv(src.evPct)}
                          </td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-nb-400">
                            {(americanToImplied(src.price) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Stake / Bankroll inputs */}
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <p className="text-[10px] text-nb-500 uppercase tracking-widest mb-1.5">Total Stake</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nb-400 text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={stake}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ''))
                        setStake(isNaN(v) ? 0 : v)
                      }}
                      className="w-full rounded-lg bg-nb-800 border border-nb-700 pl-7 pr-3 py-2.5 text-base font-mono text-white focus:outline-none focus:ring-1 focus:ring-nb-500"
                    />
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-nb-500 uppercase tracking-widest mb-1.5">Bankroll</p>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nb-400 text-sm">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={bankroll}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value.replace(/[^0-9.]/g, ''))
                        updateBankroll(isNaN(v) ? 0 : v)
                      }}
                      className="w-full rounded-lg bg-nb-800 border border-nb-700 pl-7 pr-3 py-2.5 text-base font-mono text-white focus:outline-none focus:ring-1 focus:ring-nb-500"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ── Right Panel: Opportunity Feed ──────────────── */}
      <div className="lg:w-[28%] w-full min-w-0 flex flex-col min-h-0 order-1 lg:order-2">
        {/* Header — on mobile acts as page header */}
        <div className="mb-3 sm:mb-4">
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">
                <span className="lg:hidden">Top EV Lines</span>
                <span className="hidden lg:inline">Opportunities</span>
              </h2>
              <Badge variant="pro" className="lg:hidden">PRO</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-nb-500">
            <span className="lg:hidden text-[11px] text-nb-400">
              {lines.length} positive · {totalEvents} events
            </span>
            <span className="hidden lg:inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {latestScan ? (
                <span className="text-[10px]">Last scanned {formatRelativeTime(latestScan)}</span>
              ) : (
                <span className="text-[10px]">No data yet</span>
              )}
            </span>
          </div>
        </div>

        {lines.length === 0 ? (
          <Card className="bg-nb-900 border-nb-800 flex-1">
            <CardContent className="px-6 py-16 flex flex-col items-center justify-center text-center gap-4 h-full">
              <p className="text-white text-base font-semibold">No +EV lines found</p>
              <p className="text-nb-400 text-sm max-w-sm">
                Data syncs every 2 minutes. Check back soon.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5 lg:overflow-y-auto flex-1 lg:max-h-[calc(100vh-14rem)]">
            {lines.map((line, i) => (
              <button
                key={`${line.eventId}-${line.marketType}-${line.outcomeLabel}-${i}`}
                onClick={() => setSelectedIdx(i)}
                className={`w-full text-left rounded-xl border transition-all ${
                  selectedIdx === i
                    ? 'bg-nb-800 border-nb-600 ring-2 ring-nb-500/50'
                    : 'bg-nb-900 border-nb-800 hover:bg-nb-800/60 hover:border-nb-700'
                }`}
              >
                <div className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-sm font-bold ${line.evPct >= 3 ? 'text-green-400' : line.evPct >= 1 ? 'text-yellow-400' : 'text-nb-300'}`}>
                      {formatEv(line.evPct)}
                    </span>
                    <BookLogo name={line.bestSource} size="xs" />
                  </div>
                  <p className="text-[11px] text-nb-300 font-medium truncate">
                    {line.outcomeLabel}
                  </p>
                  <p className="text-[11px] text-white font-semibold truncate">
                    {line.eventTitle}
                  </p>
                  <div className="flex items-center justify-between gap-2 text-[10px] text-nb-500 pt-0.5">
                    <span className="font-mono">{formatOdds(line.bestPrice)}</span>
                    {line.leagueAbbrev !== '—' && (
                      <span className="uppercase tracking-wider">{line.leagueAbbrev}</span>
                    )}
                    <span>{formatRelativeTime(line.lastUpdated)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
