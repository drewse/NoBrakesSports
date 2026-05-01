'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatOdds, formatRelativeTime, cn } from '@/lib/utils'
import { Calculator, ChevronLeft, Clock, DollarSign, ExternalLink, RefreshCw, Target, Wallet } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import { getBookUrl } from '@/lib/book-urls'

// Tailwind's `lg:` breakpoint is 1024px. Anything below is treated as
// the mobile two-view experience; anything ≥1024px keeps the existing
// split-pane desktop layout untouched. We use this constant in the
// click handler that flips into the mobile calculator view so the
// breakpoint stays in lock-step with the lg: utility classes.
const LG_BREAKPOINT_PX = 1024

// ── Types ────────────────────────────────────────────────────────────────────

export type UnifiedArb = {
  /** Stable identity used as React key + diff key for live polling. */
  id: string
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
  /** Live-update animation marker — set by the live wrapper. */
  _anim?: 'entering' | 'leaving'
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
  isRefreshing = false,
  onRetry,
}: {
  arbs: UnifiedArb[]
  totalArbs: number
  uniqueBooks: number
  /** SWR `isValidating` — used to disable retry button while a fetch is in flight. */
  isRefreshing?: boolean
  /** Bound to SWR `mutate()` from the live wrapper. Triggers an immediate revalidation. */
  onRetry?: () => void
}) {
  // Track selection by stable id (not index) so SWR-driven re-renders
  // don't shift the highlighted opportunity when the list changes.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [totalStake, setTotalStake] = useState(500)
  const [bankroll, setBankroll] = useState(1000)
  const [useKelly, setUseKelly] = useState(false)

  // ── Mobile two-view state ────────────────────────────────────────
  // Below the lg: breakpoint we switch between a full-screen feed and
  // a full-screen calculator. Desktop (>=1024px) ignores this state
  // entirely — both panels are always visible via the lg: classes
  // applied to the panel wrappers below.
  // savedFeedScrollY captures window.scrollY before we navigate INTO
  // the calculator view so we can restore the user's exact feed
  // position when they hit Back. Window-scoped (not container-scoped)
  // because on mobile the feed is part of the page scroll, not an
  // overflow:auto container.
  const [mobileView, setMobileView] = useState<'feed' | 'calculator'>('feed')
  const savedFeedScrollY = useRef<number>(0)

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

  const selected = selectedId !== null ? (arbs.find(a => a.id === selectedId) ?? null) : null

  useEffect(() => {
    if (useKelly && bankroll > 0 && selected) {
      const kellyFraction = Math.min(selected.profitPct / 100, 0.25)
      setTotalStake(Math.round(bankroll * kellyFraction * 100) / 100)
    }
  }, [useKelly, bankroll, selected])

  // Mobile scroll restoration — when returning to the feed, scroll back
  // to where the user tapped from. `requestAnimationFrame` fires AFTER
  // the panel has switched display state so the scroll target exists.
  // Going INTO the calculator we jump to top so the user sees the
  // selected opportunity headline first, not whatever scroll-Y the
  // feed left us at.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (mobileView === 'feed') {
      requestAnimationFrame(() => {
        window.scrollTo({ top: savedFeedScrollY.current, behavior: 'instant' as ScrollBehavior })
      })
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [mobileView])

  // Auto-return to the feed if the selected opportunity disappears
  // (live polling drops it). Without this, mobile users would be
  // stuck looking at an empty calculator panel with no exit.
  useEffect(() => {
    if (mobileView === 'calculator' && !selected) {
      setMobileView('feed')
    }
  }, [mobileView, selected])

  const selectOpportunity = useCallback((id: string) => {
    setSelectedId(id)
    if (typeof window !== 'undefined' && window.innerWidth < LG_BREAKPOINT_PX) {
      // Capture scroll-Y BEFORE the view switch — once display flips
      // the feed unmounts visually and scrollY collapses to 0.
      savedFeedScrollY.current = window.scrollY
      setMobileView('calculator')
    }
  }, [])

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
    <div className="flex flex-col lg:flex-row gap-4 sm:gap-6 lg:min-h-[calc(100vh-12rem)]">
      {/* ── Left Panel: Calculator ────────────────────────
        * Mobile: shown only when mobileView === 'calculator', with a
        * gentle slide+fade to feel like a native push transition.
        * Desktop (lg+): always visible — `lg:block` overrides `hidden`. */}
      <div
        className={cn(
          'lg:w-[72%] w-full min-w-0 flex-shrink-0 order-2 lg:order-1',
          mobileView === 'calculator'
            ? 'block animate-in fade-in slide-in-from-right-4 duration-200'
            : 'hidden lg:block',
        )}
      >
        {/* Mobile-only sticky back bar. Anchors at the top of the
          * viewport during scroll so the user always has an obvious
          * exit. lg:hidden keeps it off desktop entirely. */}
        {mobileView === 'calculator' && selected && (
          <div className="lg:hidden sticky top-0 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 mb-3 bg-nb-950/95 backdrop-blur-sm border-b border-nb-800">
            <button
              type="button"
              onClick={() => setMobileView('feed')}
              className="inline-flex items-center gap-1.5 text-nb-200 text-sm font-medium hover:text-white transition-colors"
              aria-label="Back to opportunities"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to opportunities
            </button>
          </div>
        )}
        {/* Header — hidden on mobile because it's shown above the feed */}
        <div className="hidden lg:block mb-4">
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
            <Card className="bg-nb-900 border-nb-800 hidden lg:block">
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

                {/* Open-books row — flanks the central CTA with each
                  * side's book logo. Tapping a flank opens just that
                  * side; tapping the center opens both/all. AVO-style
                  * layout: book brand visible at a glance, no need to
                  * read the smaller bet-card headers below. Disabled
                  * states cascade from URL availability per side. */}
                {(() => {
                  const sources = [
                    selected.bestSideA.source,
                    ...(selected.bestDraw ? [selected.bestDraw.source] : []),
                    selected.bestSideB.source,
                  ]
                  const urls = sources.map(s => getBookUrl(s))
                  const allKnown = urls.every(u => u != null)
                  const label = sources.length === 3 ? 'Open All 3 Books' : 'Open Both Books'
                  const urlA = getBookUrl(selected.bestSideA.source)
                  const urlB = getBookUrl(selected.bestSideB.source)
                  const urlDraw = selected.bestDraw ? getBookUrl(selected.bestDraw.source) : null

                  // Each flank: a clickable rounded panel with the book
                  // logo at lg size + an external-link icon. If we
                  // don't have the URL on file, render as a non-clickable
                  // div so the user still sees the brand but can't be
                  // led to a dead link.
                  const Flank = ({ source, url }: { source: string; url: string | null }) => {
                    const inner = (
                      <span className="inline-flex items-center gap-1.5">
                        <BookLogo name={source} size="lg" />
                        {url && <ExternalLink className="h-3.5 w-3.5 text-nb-400" />}
                      </span>
                    )
                    if (url) {
                      return (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open ${source} in a new tab`}
                          className="inline-flex h-14 px-3 rounded-xl bg-nb-800/60 border border-nb-700/50 hover:bg-nb-800 hover:border-nb-600 transition-colors items-center justify-center"
                        >
                          {inner}
                        </a>
                      )
                    }
                    return (
                      <div
                        title={`No web URL on file for ${source}`}
                        className="inline-flex h-14 px-3 rounded-xl bg-nb-800/40 border border-nb-700/40 items-center justify-center opacity-60"
                      >
                        {inner}
                      </div>
                    )
                  }

                  return (
                    <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-stretch">
                      <Flank source={selected.bestSideA.source} url={urlA} />
                      <button
                        type="button"
                        onClick={() => {
                          for (const u of urls) if (u) window.open(u, '_blank', 'noopener,noreferrer')
                        }}
                        disabled={!allKnown}
                        title={allKnown ? `Opens ${sources.join(' + ')} in new tabs` : 'No web URL on file for one of these books'}
                        className="inline-flex items-center justify-center gap-2 h-14 rounded-xl bg-green-500/15 border border-green-500/30 text-green-400 text-sm font-semibold hover:bg-green-500/25 hover:border-green-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {label}
                        {/* 3-way arbs (soccer): show a small draw chip
                          * inside the center button so all 3 books are
                          * still discoverable from this row. */}
                        {selected.bestDraw && urlDraw && (
                          <span className="inline-flex items-center gap-1 ml-1.5 pl-2 border-l border-green-500/30">
                            <BookLogo name={selected.bestDraw.source} size="sm" />
                            <span className="text-[10px] uppercase tracking-wider opacity-70">Draw</span>
                          </span>
                        )}
                      </button>
                      <Flank source={selected.bestSideB.source} url={urlB} />
                    </div>
                  )
                })()}

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

      {/* ── Right Panel: Opportunity Feed ────────────────
        * Mobile: shown only when mobileView === 'feed'.
        * Desktop (lg+): always visible — `lg:flex` overrides `hidden`. */}
      <div
        className={cn(
          'lg:w-[28%] w-full min-w-0 flex-col min-h-0 order-1 lg:order-2',
          mobileView === 'feed' ? 'flex' : 'hidden lg:flex',
        )}
      >
        {/* Header — on mobile acts as the page header */}
        <div className="mb-3 sm:mb-4">
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white truncate">
                <span className="lg:hidden">Arbitrage</span>
                <span className="hidden lg:inline">Opportunities</span>
              </h2>
              <Badge variant="pro" className="lg:hidden">PRO</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap text-nb-500">
            <span className="lg:hidden text-[11px] text-nb-400">
              {totalArbs} opportunities · {uniqueBooks} books
            </span>
            <span className="hidden lg:inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {latestScan ? (
                <span className="text-[10px]">Last updated at {formatTimestamp(latestScan)}</span>
              ) : (
                <span className="text-[10px]">No data yet</span>
              )}
            </span>
          </div>
        </div>

        {totalArbs === 0 ? (
          <Card className="bg-nb-900 border-nb-800 flex-1">
            <CardContent className="px-6 py-16 flex flex-col items-center justify-center text-center gap-4 h-full">
              <p className="text-white text-base font-semibold">No arbitrage opportunities found right now.</p>
              <p className="text-nb-400 text-sm max-w-sm">
                Odds are still updating — try widening your filters or check back in a moment.
              </p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={isRefreshing}
                  className="inline-flex items-center gap-1.5 mt-1 px-4 h-9 rounded-lg border border-nb-700 bg-nb-800 text-nb-200 text-xs font-semibold hover:bg-nb-700 hover:border-nb-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                  {isRefreshing ? 'Refreshing…' : 'Refresh now'}
                </button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2.5 lg:overflow-y-auto flex-1 lg:max-h-[calc(100vh-14rem)]">
            {arbs.map((arb) => {
              const animCls =
                arb._anim === 'leaving' ? 'live-leaving-block' :
                arb._anim === 'entering' ? 'live-entering-block' : ''
              const disabled = arb._anim === 'leaving'
              return (
              <button
                key={arb.id}
                onClick={() => { if (!disabled) selectOpportunity(arb.id) }}
                className={`w-full text-left rounded-xl border transition-all ${animCls} ${
                  selectedId === arb.id
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
              )
            })}
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
  // Whole card click-through. The book brand is now rendered on the
  // flanks of the Open Both Books row above, so the bet card header
  // shows just the bet label + an unobtrusive open-in-new-tab icon
  // when a URL is on file. Cleaner — no duplicate logo per side.
  const url = getBookUrl(source)

  const cardInner = (
    <>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-bold ${isPrimary ? 'text-white' : 'text-nb-300'}`}>{label}</span>
        {url && (
          <ExternalLink className="h-3.5 w-3.5 text-nb-500 group-hover:text-white transition-colors" />
        )}
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
    </>
  )

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`Open ${source} in a new tab`}
        className="group block bg-nb-800/60 rounded-xl border border-nb-700/50 p-4 space-y-3 hover:border-nb-600 hover:bg-nb-800 transition-colors"
      >
        {cardInner}
      </a>
    )
  }

  return (
    <div className="bg-nb-800/60 rounded-xl border border-nb-700/50 p-4 space-y-3">
      {cardInner}
    </div>
  )
}
