'use client'

import { formatOdds, formatRelativeTime } from '@/lib/utils'

export interface PropArb {
  eventTitle: string
  league: string
  propCategory: string
  playerName: string
  lineValue: number | null
  bestOverPrice: number
  bestOverSource: string
  bestUnderPrice: number
  bestUnderSource: string
  overProb: number
  underProb: number
  combinedProb: number
  profitPct: number
  lastUpdated: string
}

export function PropArbTable({ arbs }: { arbs: PropArb[] }) {
  if (arbs.length === 0) {
    return (
      <div className="px-6 py-12 flex flex-col items-center justify-center text-center gap-3">
        <p className="text-white text-sm font-medium">
          No prop arbitrage opportunities detected
        </p>
        <p className="text-nb-400 text-xs max-w-sm">
          Prop arbs are scanned every 2 minutes across Kambi (BetRivers) and Pinnacle.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-nb-800">
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Player</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Prop</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Line</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Event</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Best Over</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Best Under</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Combined</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Profit %</th>
            <th className="px-4 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider">Updated</th>
          </tr>
        </thead>
        <tbody>
          {arbs.map((arb, i) => (
            <tr
              key={i}
              className={`border-b border-border/50 hover:bg-nb-800/20 transition-colors ${
                arb.profitPct > 2 ? 'border-l-2 border-l-white' : ''
              }`}
            >
              <td className="px-4 py-2.5">
                <span className="text-white text-xs font-medium">{arb.playerName}</span>
              </td>
              <td className="px-4 py-2.5">
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-900/50 text-violet-300">
                  {formatPropCategory(arb.propCategory)}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className="font-mono text-xs text-nb-300">
                  {arb.lineValue != null ? arb.lineValue : '—'}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-nb-300 text-xs">{arb.eventTitle}</span>
                  <span className="text-nb-500 text-[10px]">{arb.league}</span>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs text-green-400">{formatOdds(arb.bestOverPrice)}</span>
                  <span className="text-[10px] text-nb-400">{arb.bestOverSource}</span>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-xs text-green-400">{formatOdds(arb.bestUnderPrice)}</span>
                  <span className="text-[10px] text-nb-400">{arb.bestUnderSource}</span>
                </div>
              </td>
              <td className="px-4 py-2.5">
                <CombinedProbDisplay value={arb.combinedProb} />
              </td>
              <td className="px-4 py-2.5">
                <ProfitDisplay value={arb.profitPct} />
              </td>
              <td className="px-4 py-2.5">
                <span className="text-nb-400 text-xs">{formatRelativeTime(arb.lastUpdated)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Display helpers ──────────────────────────────────────────────────────────

const PROP_LABELS: Record<string, string> = {
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers',
  player_pts_reb_ast: 'PRA',
  player_steals: 'Steals',
  player_blocks: 'Blocks',
  player_turnovers: 'Turnovers',
  player_double_double: 'Dbl-Dbl',
  player_triple_double: 'Trp-Dbl',
  player_hits: 'Hits',
  player_home_runs: 'HRs',
  player_rbis: 'RBIs',
  player_strikeouts_p: 'Ks',
  player_total_bases: 'Total Bases',
  player_runs: 'Runs',
  player_goals: 'Goals',
  player_shots_on_goal: 'SOG',
  player_saves: 'Saves',
}

function formatPropCategory(cat: string): string {
  return PROP_LABELS[cat] ?? cat.replace(/^player_/, '').replace(/_/g, ' ')
}

function ProfitDisplay({ value }: { value: number }) {
  if (value > 1) return <span className="font-mono text-xs font-bold text-white">{value.toFixed(2)}%</span>
  if (value >= 0.5) return <span className="font-mono text-xs text-nb-300">{value.toFixed(2)}%</span>
  return <span className="font-mono text-xs text-nb-400">{value.toFixed(2)}%</span>
}

function CombinedProbDisplay({ value }: { value: number }) {
  const pct = value * 100
  if (pct < 98) return <span className="font-mono text-xs text-green-400">{pct.toFixed(1)}%</span>
  if (pct < 99.5) return <span className="font-mono text-xs text-yellow-400">{pct.toFixed(1)}%</span>
  return <span className="font-mono text-xs text-red-400">{pct.toFixed(1)}%</span>
}
