'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { formatOdds, formatRelativeTime } from '@/lib/utils'
import { Calculator, Clock, DollarSign, Target, Wallet } from 'lucide-react'

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
  const [totalStake, setTotalStake] = useState(100)
  const [bankroll, setBankroll] = useState(1000)
  const [useKelly, setUseKelly] = useState(false)

  // Load bankroll from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(BANKROLL_KEY)
    if (stored) {
      const val = parseFloat(stored)
      if (!isNaN(val) && val > 0) setBankroll(val)
    }
  }, [])

  // Save bankroll
  const updateBankroll = useCallback((val: number) => {
    setBankroll(val)
    localStorage.setItem(BANKROLL_KEY, String(val))
  }, [])

  // Kelly criterion: optimal fraction = edge / (decimal odds - 1)
  // For arb: stake = totalStake allocated proportionally
  useEffect(() => {
    if (useKelly && bankroll > 0 && selectedIdx !== null) {
      const arb = arbs[selectedIdx]
      if (arb) {
        // Kelly for arb: fraction of bankroll = profitPct / 100
        // Capped at 25% of bankroll
        const kellyFraction = Math.min(arb.profitPct / 100, 0.25)
        setTotalStake(Math.round(bankroll * kellyFraction * 100) / 100)
      }
    }
  }, [useKelly, bankroll, selectedIdx, arbs])

  const selected = selectedIdx !== null ? arbs[selectedIdx] : null

  // Build sides array for calculation
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

  // Newest update timestamp across all arbs
  const latestScan = arbs.length > 0
    ? arbs.reduce((latest, a) => (a.lastUpdated > latest ? a.lastUpdated : latest), arbs[0].lastUpdated)
    : null

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[calc(100vh-12rem)]">
      {/* ── Left Panel: Calculator (60%) ──────────────────────── */}
      <div className="lg:w-[60%] w-full flex-shrink-0">
        <div className="sticky top-4">
          {!selected ? (
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="px-6 py-20 flex flex-col items-center justify-center text-center gap-4">
                <div className="h-12 w-12 rounded-full bg-nb-800 border border-nb-700 flex items-center justify-center">
                  <Calculator className="h-5 w-5 text-nb-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium mb-1">
                    Select an opportunity
                  </p>
                  <p className="text-nb-400 text-xs max-w-xs">
                    Click any arbitrage opportunity in the feed to load it into
                    the calculator.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-5 space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={selected.type === 'prop' ? 'outline' : 'default'}
                        className={
                          selected.type === 'prop'
                            ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                            : ''
                        }
                      >
                        {selected.type === 'prop' ? 'PROP' : 'GAME'}
                      </Badge>
                      <Badge variant="muted">{selected.league}</Badge>
                    </div>
                    <h2 className="text-white text-sm font-semibold truncate">
                      {selected.eventTitle}
                    </h2>
                    <p className="text-nb-400 text-xs mt-0.5">
                      {selected.description}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-green-400 text-xl font-bold font-mono">
                      {selected.profitPct.toFixed(2)}%
                    </div>
                    <p className="text-nb-500 text-[10px] uppercase tracking-wider">
                      Profit
                    </p>
                  </div>
                </div>

                {/* Bet Cards */}
                <div
                  className={`grid gap-3 ${
                    selected.bestDraw ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'
                  }`}
                >
                  {/* Side A */}
                  <BetCard
                    label={selected.bestSideA.label}
                    source={selected.bestSideA.source}
                    price={selected.bestSideA.price}
                    stake={calc ? calc.stakes[0] : 0}
                    payout={calc ? calc.payouts[0] : 0}
                    isPrimary
                  />

                  {/* Draw (if 3-way) */}
                  {selected.bestDraw && (
                    <BetCard
                      label="Draw"
                      source={selected.bestDraw.source}
                      price={selected.bestDraw.price}
                      stake={calc ? calc.stakes[1] : 0}
                      payout={calc ? calc.payouts[1] : 0}
                    />
                  )}

                  {/* Side B */}
                  <BetCard
                    label={selected.bestSideB.label}
                    source={selected.bestSideB.source}
                    price={selected.bestSideB.price}
                    stake={
                      calc
                        ? calc.stakes[selected.bestDraw ? 2 : 1]
                        : 0
                    }
                    payout={
                      calc
                        ? calc.payouts[selected.bestDraw ? 2 : 1]
                        : 0
                    }
                  />
                </div>

                {/* Center Summary */}
                {calc && (
                  <div className="bg-nb-800/50 rounded-lg border border-nb-700/50 p-4">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="text-nb-500 text-[10px] uppercase tracking-wider mb-1">
                          Total Invested
                        </p>
                        <p className="text-white text-sm font-mono font-semibold">
                          ${totalStake.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-nb-500 text-[10px] uppercase tracking-wider mb-1">
                          Guaranteed Profit
                        </p>
                        <p className="text-green-400 text-sm font-mono font-bold">
                          +${calc.profit.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-nb-500 text-[10px] uppercase tracking-wider mb-1">
                          Return
                        </p>
                        <p className="text-green-400 text-sm font-mono font-bold">
                          {selected.profitPct.toFixed(2)}%
                        </p>
                      </div>
                    </div>

                    {/* Bet instructions */}
                    <div className="mt-4 pt-3 border-t border-nb-700/50 space-y-1.5">
                      {sides.map((side, i) => (
                        <p key={i} className="text-xs text-nb-300">
                          <span className="text-white font-medium">
                            Bet ${calc.stakes[i].toFixed(2)}
                          </span>{' '}
                          on{' '}
                          <span className="text-white">
                            {side.label}
                          </span>{' '}
                          @{' '}
                          <span className="font-mono text-white">
                            {formatOdds(side.price)}
                          </span>{' '}
                          on{' '}
                          <span className="text-nb-200">
                            {side.source}
                          </span>
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inputs: Total Stake, Bankroll, Kelly */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] text-nb-500 uppercase tracking-wider font-medium mb-1.5 block">
                      <DollarSign className="h-3 w-3 inline mr-1" />
                      Total Stake
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nb-400 text-sm">
                        $
                      </span>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={totalStake}
                        onChange={(e) => {
                          setUseKelly(false)
                          setTotalStake(parseFloat(e.target.value) || 0)
                        }}
                        className="pl-7 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-nb-500 uppercase tracking-wider font-medium mb-1.5 block">
                      <Wallet className="h-3 w-3 inline mr-1" />
                      Bankroll
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-nb-400 text-sm">
                        $
                      </span>
                      <Input
                        type="number"
                        min={1}
                        step={100}
                        value={bankroll}
                        onChange={(e) =>
                          updateBankroll(parseFloat(e.target.value) || 0)
                        }
                        className="pl-7 font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-nb-500 uppercase tracking-wider font-medium mb-1.5 block">
                      <Target className="h-3 w-3 inline mr-1" />
                      Kelly Sizing
                    </label>
                    <button
                      onClick={() => setUseKelly(!useKelly)}
                      className={`w-full h-9 rounded-md border text-sm font-medium transition-colors ${
                        useKelly
                          ? 'bg-green-500/10 border-green-500/30 text-green-400'
                          : 'bg-nb-800 border-nb-700 text-nb-400 hover:text-nb-300 hover:border-nb-600'
                      }`}
                    >
                      {useKelly ? 'Kelly ON' : 'Kelly OFF'}
                    </button>
                  </div>
                </div>

                {/* Updated timestamp */}
                <div className="flex items-center justify-end gap-1.5 text-nb-500">
                  <Clock className="h-3 w-3" />
                  <span className="text-[10px]">
                    Updated {formatRelativeTime(selected.lastUpdated)}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── Right Panel: Opportunity Feed (40%) ──────────────── */}
      <div className="lg:w-[40%] w-full flex flex-col min-h-0">
        {/* Feed Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-white text-sm font-semibold">
              Opportunities
            </h2>
            <p className="text-nb-500 text-[10px]">
              {totalArbs} found across {uniqueBooks} books
            </p>
          </div>
          {latestScan && (
            <div className="flex items-center gap-1.5 text-nb-500">
              <Clock className="h-3 w-3" />
              <span className="text-[10px]">
                Last scanned {formatRelativeTime(latestScan)}
              </span>
            </div>
          )}
        </div>

        {/* Feed */}
        {totalArbs === 0 ? (
          <Card className="bg-nb-900 border-nb-800 flex-1">
            <CardContent className="px-6 py-12 flex flex-col items-center justify-center text-center gap-3 h-full">
              <p className="text-white text-sm font-medium">
                No arbitrage opportunities detected
              </p>
              <p className="text-nb-400 text-xs max-w-sm">
                Opportunities are rare and short-lived. Data syncs every
                2 minutes.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2 overflow-y-auto flex-1 pr-1 lg:max-h-[calc(100vh-14rem)]">
            {arbs.map((arb, i) => (
              <button
                key={i}
                onClick={() => setSelectedIdx(i)}
                className={`w-full text-left rounded-lg border transition-all ${
                  selectedIdx === i
                    ? 'bg-nb-800 border-nb-600 ring-1 ring-nb-600'
                    : 'bg-nb-900 border-nb-800 hover:bg-nb-800/60 hover:border-nb-700'
                }`}
              >
                <div className="p-3 space-y-2">
                  {/* Top row: badges + profit */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Badge
                        variant={arb.type === 'prop' ? 'outline' : 'muted'}
                        className={`text-[9px] flex-shrink-0 ${
                          arb.type === 'prop'
                            ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                            : ''
                        }`}
                      >
                        {arb.type === 'prop' ? 'PROP' : 'GAME'}
                      </Badge>
                      <span className="text-[10px] text-nb-500 flex-shrink-0">
                        {arb.league}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-sm font-bold flex-shrink-0 ${
                        arb.profitPct > 1
                          ? 'text-green-400'
                          : arb.profitPct >= 0.5
                          ? 'text-nb-200'
                          : 'text-nb-400'
                      }`}
                    >
                      {arb.profitPct.toFixed(2)}%
                    </span>
                  </div>

                  {/* Event title */}
                  <p className="text-white text-xs font-medium truncate">
                    {arb.eventTitle}
                  </p>

                  {/* Description */}
                  <p className="text-nb-400 text-[10px] truncate">
                    {arb.description}
                  </p>

                  {/* Bottom row: books + time */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-[10px] text-nb-300 font-mono">
                        {formatOdds(arb.bestSideA.price)}
                      </span>
                      <span className="text-nb-600 text-[10px]">
                        {arb.bestSideA.source}
                      </span>
                      <span className="text-nb-700 text-[10px] mx-0.5">
                        vs
                      </span>
                      <span className="text-[10px] text-nb-300 font-mono">
                        {formatOdds(arb.bestSideB.price)}
                      </span>
                      <span className="text-nb-600 text-[10px]">
                        {arb.bestSideB.source}
                      </span>
                    </div>
                    <span className="text-[10px] text-nb-500 flex-shrink-0">
                      {formatRelativeTime(arb.lastUpdated)}
                    </span>
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

// ── Bet Card Sub-component ───────────────────────────────────────────────────

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
    <div className="bg-nb-800/60 rounded-lg border border-nb-700/50 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${isPrimary ? 'text-white' : 'text-nb-300'}`}>
          {label}
        </span>
        <span className="text-[10px] text-nb-500">{source}</span>
      </div>
      <div className="text-center">
        <p className="font-mono text-xl font-bold text-white">
          {formatOdds(price)}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div>
          <p className="text-[10px] text-nb-500 uppercase tracking-wider">
            Stake
          </p>
          <p className="font-mono text-xs text-nb-200">
            ${stake.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-nb-500 uppercase tracking-wider">
            Payout
          </p>
          <p className="font-mono text-xs text-green-400">
            ${payout.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  )
}
