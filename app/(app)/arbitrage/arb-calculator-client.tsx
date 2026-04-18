'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatOdds, formatRelativeTime } from '@/lib/utils'
import { Calculator, Clock, DollarSign, Target, Wallet } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'

// ── Types ────────────────────────────────────────────────────────────────────

export type UnifiedArb = {
  type: 'game' | 'prop'
  eventTitle: string
  league: string
  description: string
  bestSideA: { label: string; price: number; source: string }
  bestSideB: { label: string; price: number; source: string }
  bestDraw?: { price: number; source: string } | null
  combinedProb: number
  profitPct: number
  lastUpdated: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function americanToDecimal(american: number): number {
  if (american > 0) return american / 100 + 1
  return 100 / Math.abs(american) + 1
}

function calculateArbStakes(
  totalStake: number,
  sides: { price: number }[]
): { stakes: number[]; payouts: number[]; profit: number } {
  const decimals = sides.map((s) => americanToDecimal(s.price))
  const inverseSum = decimals.reduce((sum, d) => sum + 1 / d, 0)
  const stakes = decimals.map((d) => totalStake / (d * inverseSum))
  const payouts = stakes.map((s, i) => s * decimals[i])
  const profit = payouts[0] - totalStake
  return { stakes, payouts, profit }
}

const BANKROLL_KEY = 'nb-arb-bankroll'

// ── Main Client Component ────────────────────────────────────────────────────

export function ArbCalculatorClient({
  arbs,
  totalArbs,
  uniqueBooks,
}: {
  arbs: UnifiedArb[]
  totalArbs: number
  uniqueBooks: number
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [totalStake, setTotalStake] = useState(500)
  const [bankroll, setBankroll] = useState(1000)
  const [useKelly, setUseKelly] = useState(false)

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

  useEffect(() => {
    if (useKelly && bankroll > 0 && selectedIdx !== null) {
      const arb = arbs[selectedIdx]
      if (arb) {
        const kellyFraction = Math.min(arb.profitPct / 100, 0.25)
        setTotalStake(Math.round(bankroll * kellyFraction * 100) / 100)
      }
    }
  }, [useKelly, bankroll, selectedIdx, arbs])

  const selected = selectedIdx !== null ? arbs[selectedIdx] : null

  const sides: { label: string; price: number; source: string }[] = selected
    ? [
        { label: selected.bestSideA.label, price: selected.bestSideA.price, source: selected.bestSideA.source },
        ...(selected.bestDraw ? [{ label: 'Draw', price: selected.bestDraw.price, source: selected.bestDraw.source }] : []),
        { label: selected.bestSideB.label, price: selected.bestSideB.price, source: selected.bestSideB.source },
      ]
    : []

  const calc =
    selected && sides.length >= 2
      ? calculateArbStakes(totalStake, sides)
      : null

  const latestScan = arbs.length > 0
    ? arbs.reduce((latest, a) => (a.lastUpdated > latest ? a.lastUpdated : latest), arbs[0].lastUpdated)
    : null

  function formatTimestamp(iso: string): string {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true,
    })
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 min-h-[calc(100vh-12rem)]">
      {/* ── Left Panel: Calculator ──────────────────────── */}
      <div className="lg:w-[72%] w-full flex-shrink-0 order-2 lg:order-1">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-lg font-bold text-white">Arbitrage</h1>
            <Badge variant="pro">PRO</Badge>
          </div>
          <p className="text-xs text-nb-400">
            {totalArbs} opportunities detected across {uniqueBooks} books
          </p>
        </div>
        <div className="lg:sticky lg:top-4">
          {!selected ? (
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="px-8 py-24 flex flex-col items-center justify-center text-center gap-5">
                <div className="h-16 w-16 rounded-full bg-nb-800 border border-nb-700 flex items-center justify-center">
                  <Calculator className="h-7 w-7 text-nb-400" />
                </div>
                <div>
                  <p className="text-white text-lg font-semibold mb-2">Select an opportunity</p>
                  <p className="text-nb-400 text-sm max-w-sm">
                    Click any opportunity from the feed to load it into the calculator.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-6 space-y-6">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant={selected.type === 'prop' ? 'outline' : 'default'}
                        className={`text-xs ${
                          selected.type === 'prop'
                            ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                            : ''
                        }`}
                      >
                        {selected.type === 'prop' ? 'PROP' : 'GAME'}
                      </Badge>
                      <Badge variant="muted" className="text-xs">{selected.league}</Badge>
                    </div>
                    <h2 className="text-white text-lg font-bold truncate">{selected.eventTitle}</h2>
                    <p className="text-nb-400 text-sm mt-1">{selected.description}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-3xl font-bold font-mono ${selected.profitPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {selected.profitPct.toFixed(2)}%
                    </div>
                    <p className="text-nb-500 text-xs uppercase tracking-wider mt-1">Profit</p>
                  </div>
                </div>

                {/* Bet Cards */}
                <div className={`grid gap-4 ${selected.bestDraw ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                  <BetCard
                    label={selected.bestSideA.label}
                    source={selected.bestSideA.source}
                    price={selected.bestSideA.price}
                    stake={calc ? calc.stakes[0] : 0}
                    payout={calc ? calc.payouts[0] : 0}
                    isPrimary
                  />
                  {selected.bestDraw && (
                    <BetCard
                      label="Draw"
                      source={selected.bestDraw.source}
                      price={selected.bestDraw.price}
                      stake={calc ? calc.stakes[1] : 0}
                      payout={calc ? calc.payouts[1] : 0}
                    />
                  )}
                  <BetCard
                    label={selected.bestSideB.label}
                    source={selected.bestSideB.source}
                    price={selected.bestSideB.price}
                    stake={calc ? calc.stakes[selected.bestDraw ? 2 : 1] : 0}
                    payout={calc ? calc.payouts[selected.bestDraw ? 2 : 1] : 0}
                  />
                </div>

                {/* Summary */}
                {calc && (
                  <div className="bg-nb-800/50 rounded-xl border border-nb-700/50 p-5">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-nb-500 text-xs uppercase tracking-wider mb-1">Total Invested</p>
                        <p className="text-white text-lg font-mono font-bold">${totalStake.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-nb-500 text-xs uppercase tracking-wider mb-1">Guaranteed Profit</p>
                        <p className={`text-lg font-mono font-bold ${calc.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {calc.profit >= 0 ? '+' : ''}${calc.profit.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-nb-500 text-xs uppercase tracking-wider mb-1">Return</p>
                        <p className={`text-lg font-mono font-bold ${selected.profitPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {selected.profitPct.toFixed(2)}%
                        </p>
                      </div>
                    </div>

                    {/* Bet instructions */}
                    <div className="mt-4 pt-4 border-t border-nb-700/50 space-y-2">
                      {sides.map((side, i) => (
                        <p key={i} className="text-sm text-nb-300">
                          <span className="text-white font-semibold">Bet ${calc.stakes[i].toFixed(2)}</span>
                          {' '}on{' '}
                          <span className="text-white font-medium">{side.label}</span>
                          {' '}@{' '}
                          <span className="font-mono text-white font-semibold">{formatOdds(side.price)}</span>
                          {' '}on{' '}
                          <BookLogo name={side.source} size="xs" />
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-nb-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                      <DollarSign className="h-3.5 w-3.5" />
                      Total Stake
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nb-400 text-base font-mono">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={totalStake}
                        onChange={(e) => {
                          setUseKelly(false)
                          const val = parseFloat(e.target.value)
                          setTotalStake(isNaN(val) ? 0 : val)
                        }}
                        className="w-full h-11 pl-8 pr-3 rounded-lg border border-nb-700 bg-nb-800 text-white text-base font-mono focus:outline-none focus:ring-1 focus:ring-nb-500 focus:border-nb-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-nb-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5" />
                      Bankroll
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nb-400 text-base font-mono">$</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={bankroll}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          updateBankroll(isNaN(val) ? 0 : val)
                        }}
                        className="w-full h-11 pl-8 pr-3 rounded-lg border border-nb-700 bg-nb-800 text-white text-base font-mono focus:outline-none focus:ring-1 focus:ring-nb-500 focus:border-nb-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-nb-500 uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5">
                      <Target className="h-3.5 w-3.5" />
                      Kelly Sizing
                    </label>
                    <button
                      onClick={() => setUseKelly(!useKelly)}
                      className={`w-full h-11 rounded-lg border text-base font-semibold transition-colors ${
                        useKelly
                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                          : 'bg-nb-800 border-nb-700 text-nb-400 hover:text-nb-300 hover:border-nb-600'
                      }`}
                    >
                      {useKelly ? 'Kelly ON' : 'Kelly OFF'}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-1.5 text-nb-500">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="text-xs">Updated {formatRelativeTime(selected.lastUpdated)}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Right Panel: Opportunity Feed ──────────────── */}
      <div className="lg:w-[28%] w-full flex flex-col min-h-0 order-1 lg:order-2">
        {/* Header — aligned with left panel */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-white">Opportunities</h2>
          </div>
          <div className="flex items-center gap-1 text-nb-500">
            <Clock className="h-3 w-3" />
            {latestScan ? (
              <span className="text-[10px]">Last updated at {formatTimestamp(latestScan)}</span>
            ) : (
              <span className="text-[10px]">No data yet</span>
            )}
          </div>
        </div>

        {totalArbs === 0 ? (
          <Card className="bg-nb-900 border-nb-800 flex-1">
            <CardContent className="px-6 py-16 flex flex-col items-center justify-center text-center gap-4 h-full">
              <p className="text-white text-base font-semibold">No opportunities detected</p>
              <p className="text-nb-400 text-sm max-w-sm">
                Data syncs every 2 minutes. Opportunities are rare and short-lived.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5 overflow-y-auto flex-1 lg:max-h-[calc(100vh-14rem)]">
            {arbs.map((arb, i) => (
              <button
                key={i}
                onClick={() => setSelectedIdx(i)}
                className={`w-full text-left rounded-xl border transition-all ${
                  selectedIdx === i
                    ? 'bg-nb-800 border-nb-600 ring-2 ring-nb-500/50'
                    : 'bg-nb-900 border-nb-800 hover:bg-nb-800/60 hover:border-nb-700'
                }`}
              >
                <div className="p-3 space-y-1.5">
                  {/* Top row */}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge
                        variant={arb.type === 'prop' ? 'outline' : 'muted'}
                        className={`text-[9px] px-1.5 py-0 flex-shrink-0 ${
                          arb.type === 'prop' ? 'bg-violet-500/10 text-violet-400 border-violet-500/20' : ''
                        }`}
                      >
                        {arb.type === 'prop' ? 'PROP' : 'GAME'}
                      </Badge>
                      <span className="text-[10px] text-nb-500 flex-shrink-0">{arb.league}</span>
                    </div>
                    <span className={`font-mono text-sm font-bold flex-shrink-0 ${
                      arb.profitPct > 0 ? 'text-green-400' : arb.profitPct > -1 ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {arb.profitPct > 0 ? '+' : ''}{arb.profitPct.toFixed(2)}%
                    </span>
                  </div>

                  {/* Event + description */}
                  <p className="text-white text-xs font-semibold truncate">{arb.eventTitle}</p>
                  <p className="text-nb-400 text-[11px] truncate">{arb.description}</p>

                  {/* Books + odds */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0 text-[11px] flex-wrap">
                      <span className="text-nb-200 font-mono font-semibold">{formatOdds(arb.bestSideA.price)}</span>
                      <BookLogo name={arb.bestSideA.source} size="xs" />
                      <span className="text-nb-700">vs</span>
                      <span className="text-nb-200 font-mono font-semibold">{formatOdds(arb.bestSideB.price)}</span>
                      <BookLogo name={arb.bestSideB.source} size="xs" />
                    </div>
                    <span className="text-[10px] text-nb-600 flex-shrink-0">{formatRelativeTime(arb.lastUpdated)}</span>
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

// ── Bet Card ─────────────────────────────────────────────────────────────────

function BetCard({
  label,
  source,
  price,
  stake,
  payout,
  isPrimary,
}: {
  label: string
  source: string
  price: number
  stake: number
  payout: number
  isPrimary?: boolean
}) {
  return (
    <div className="bg-nb-800/60 rounded-xl border border-nb-700/50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className={`text-sm font-bold ${isPrimary ? 'text-white' : 'text-nb-300'}`}>{label}</span>
        <BookLogo name={source} size="md" />
      </div>
      <div className="text-center py-1">
        <p className="font-mono text-3xl font-bold text-white">{formatOdds(price)}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-center">
        <div>
          <p className="text-xs text-nb-500 uppercase tracking-wider mb-1">Stake</p>
          <p className="font-mono text-sm text-nb-200 font-semibold">${stake.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-nb-500 uppercase tracking-wider mb-1">Payout</p>
          <p className="font-mono text-sm text-green-400 font-semibold">${payout.toFixed(2)}</p>
        </div>
      </div>
    </div>
  )
}
