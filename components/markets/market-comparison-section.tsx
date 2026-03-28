'use client'

import { useMemo } from 'react'
import { formatOdds, formatSpread } from '@/lib/utils'
import type { MarketSnapshot } from '@/types'

interface MarketComparisonSectionProps {
  marketType: string
  snapshots: MarketSnapshot[]
  homeTeam: string
  awayTeam: string
  /** If true, draw column is shown for moneyline */
  isThreeWay: boolean
}

// Returns true if this value is strictly the best (highest) among all non-null values.
// Requires at least 2 valid values to highlight (no competition = no highlight).
function isBest(value: number | null, allValues: (number | null)[]): boolean {
  if (value == null) return false
  const valid = allValues.filter((v): v is number => v != null)
  if (valid.length < 2) return false
  return value === Math.max(...valid)
}

function BestMark() {
  return (
    <span
      className="ml-1 inline-block text-[9px] font-bold text-white bg-nb-700 border border-nb-500 rounded px-1 py-0.5 leading-none align-middle"
      title="Best available price"
    >
      BEST
    </span>
  )
}

function PriceCell({
  price,
  best,
  dim = false,
}: {
  price: number | null
  best: boolean
  dim?: boolean
}) {
  if (price == null) {
    return <span className="text-xs font-mono text-nb-600">—</span>
  }
  return (
    <span
      className={[
        'text-xs font-mono whitespace-nowrap',
        best
          ? 'text-white font-semibold'
          : dim
          ? 'text-nb-500'
          : 'text-nb-300',
      ].join(' ')}
    >
      {formatOdds(price)}
      {best && <BestMark />}
    </span>
  )
}

// ─── MONEYLINE ────────────────────────────────────────────────────────────────

function MoneylineTable({
  snapshots,
  homeTeam,
  awayTeam,
  isThreeWay,
}: {
  snapshots: MarketSnapshot[]
  homeTeam: string
  awayTeam: string
  isThreeWay: boolean
}) {
  const homePrices = snapshots.map(s => s.home_price)
  const awayPrices = snapshots.map(s => s.away_price)
  const drawPrices = snapshots.map(s => s.draw_price)

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border/60">
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider w-40">
              Source
            </th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
              {homeTeam || 'Home'}
            </th>
            {isThreeWay && (
              <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                Draw
              </th>
            )}
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
              {awayTeam || 'Away'}
            </th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((snap, i) => (
            <tr key={snap.id} className="border-b border-border/30 hover:bg-nb-800/20 transition-colors">
              <td className="px-4 py-2.5">
                <span className="text-xs text-nb-300 font-medium">
                  {(snap.source as any)?.name ?? '—'}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <PriceCell
                  price={snap.home_price}
                  best={isBest(snap.home_price, homePrices)}
                />
              </td>
              {isThreeWay && (
                <td className="px-4 py-2.5">
                  <PriceCell
                    price={snap.draw_price}
                    best={isBest(snap.draw_price, drawPrices)}
                  />
                </td>
              )}
              <td className="px-4 py-2.5">
                <PriceCell
                  price={snap.away_price}
                  best={isBest(snap.away_price, awayPrices)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── SPREAD ───────────────────────────────────────────────────────────────────

function SpreadTable({
  snapshots,
  homeTeam,
  awayTeam,
}: {
  snapshots: MarketSnapshot[]
  homeTeam: string
  awayTeam: string
}) {
  // Group by spread_value — different sources may have different lines
  const groups = useMemo(() => {
    const map = new Map<number, MarketSnapshot[]>()
    for (const snap of snapshots) {
      if (snap.spread_value == null) continue
      const existing = map.get(snap.spread_value) ?? []
      map.set(snap.spread_value, [...existing, snap])
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [snapshots])

  if (groups.length === 0) {
    return <p className="px-4 py-4 text-xs text-nb-500">No spread data available.</p>
  }

  return (
    <div className="space-y-4">
      {groups.map(([spreadValue, groupSnaps]) => {
        const homePrices = groupSnaps.map(s => s.home_price)
        const awayPrices = groupSnaps.map(s => s.away_price)
        const awaySpreadValue = -spreadValue

        return (
          <div key={spreadValue}>
            {groups.length > 1 && (
              <div className="px-4 py-1.5 bg-nb-900/60 border-b border-border/40">
                <span className="text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                  Line: {formatSpread(spreadValue)} / {formatSpread(awaySpreadValue)}
                </span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider w-40">
                      Source
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                      {homeTeam || 'Home'} {formatSpread(spreadValue)}
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                      {awayTeam || 'Away'} {formatSpread(awaySpreadValue)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupSnaps.map((snap) => (
                    <tr key={snap.id} className="border-b border-border/30 hover:bg-nb-800/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-nb-300 font-medium">
                          {(snap.source as any)?.name ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <PriceCell
                          price={snap.home_price}
                          best={isBest(snap.home_price, homePrices)}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <PriceCell
                          price={snap.away_price}
                          best={isBest(snap.away_price, awayPrices)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── TOTAL ────────────────────────────────────────────────────────────────────

function TotalTable({ snapshots }: { snapshots: MarketSnapshot[] }) {
  // Group by total_value — different sources may post different lines
  const groups = useMemo(() => {
    const map = new Map<number, MarketSnapshot[]>()
    for (const snap of snapshots) {
      if (snap.total_value == null) continue
      const existing = map.get(snap.total_value) ?? []
      map.set(snap.total_value, [...existing, snap])
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0])
  }, [snapshots])

  if (groups.length === 0) {
    return <p className="px-4 py-4 text-xs text-nb-500">No total data available.</p>
  }

  return (
    <div className="space-y-4">
      {groups.map(([totalValue, groupSnaps]) => {
        // Over is stored in home_price (per sync logic)
        const overPrices = groupSnaps.map(s => s.home_price)

        return (
          <div key={totalValue}>
            {groups.length > 1 && (
              <div className="px-4 py-1.5 bg-nb-900/60 border-b border-border/40">
                <span className="text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                  O/U {totalValue}
                </span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/60">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider w-40">
                      Source
                    </th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
                      Over {totalValue}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupSnaps.map((snap) => (
                    <tr key={snap.id} className="border-b border-border/30 hover:bg-nb-800/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-xs text-nb-300 font-medium">
                          {(snap.source as any)?.name ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <PriceCell
                          price={snap.home_price}
                          best={isBest(snap.home_price, overPrices)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

const MARKET_TYPE_LABELS: Record<string, string> = {
  moneyline: 'Moneyline',
  spread: 'Spread',
  total: 'Total',
  prop: 'Prop',
  futures: 'Futures',
}

export function MarketComparisonSection({
  marketType,
  snapshots,
  homeTeam,
  awayTeam,
  isThreeWay,
}: MarketComparisonSectionProps) {
  const label = MARKET_TYPE_LABELS[marketType] ?? marketType

  // Deduplicate: keep the latest snapshot per source (data is pre-sorted newest first)
  const deduped = useMemo(() => {
    const seen = new Set<string>()
    return snapshots.filter(s => {
      if (seen.has(s.source_id)) return false
      seen.add(s.source_id)
      return true
    })
  }, [snapshots])

  if (deduped.length === 0) return null

  return (
    <section className="rounded-lg border border-border overflow-hidden">
      {/* Section header */}
      <div className="flex items-center justify-between px-4 py-3 bg-nb-900/60 border-b border-border">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">{label}</h3>
          <span className="text-[10px] text-nb-500 font-mono">
            {deduped.length} source{deduped.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Comparison table */}
      {marketType === 'moneyline' && (
        <MoneylineTable
          snapshots={deduped}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          isThreeWay={isThreeWay}
        />
      )}
      {marketType === 'spread' && (
        <SpreadTable
          snapshots={deduped}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
        />
      )}
      {marketType === 'total' && (
        <TotalTable snapshots={deduped} />
      )}
      {marketType !== 'moneyline' && marketType !== 'spread' && marketType !== 'total' && (
        <div className="px-4 py-4">
          <p className="text-xs text-nb-500">
            Detailed comparison not available for {label} markets.
          </p>
        </div>
      )}
    </section>
  )
}
