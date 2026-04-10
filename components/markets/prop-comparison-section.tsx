'use client'

import { useState, useMemo } from 'react'
import { formatOdds } from '@/lib/utils'

interface PropOdd {
  source_id: string
  source_name: string
  source_slug: string
  prop_category: string
  player_name: string
  line_value: number | null
  over_price: number | null
  under_price: number | null
  yes_price: number | null
  no_price: number | null
  snapshot_time: string
}

interface PropComparisonSectionProps {
  props: PropOdd[]
}

const CATEGORY_LABELS: Record<string, string> = {
  player_points: 'Points',
  player_rebounds: 'Rebounds',
  player_assists: 'Assists',
  player_threes: '3-Pointers',
  player_pts_reb_ast: 'PTS+REB+AST',
  player_steals: 'Steals',
  player_blocks: 'Blocks',
  player_turnovers: 'Turnovers',
  player_double_double: 'Double-Double',
  player_triple_double: 'Triple-Double',
  player_hits: 'Hits',
  player_home_runs: 'Home Runs',
  player_rbis: 'RBIs',
  player_strikeouts_p: 'Pitcher Strikeouts',
  player_total_bases: 'Total Bases',
  player_runs: 'Runs',
  player_goals: 'Goals',
  player_shots_on_goal: 'Shots on Goal',
  player_saves: 'Saves',
  player_hockey_assists: 'Assists',
  player_hockey_points: 'Points',
  team_total: 'Team Total',
  half_total: '1H Total',
  half_spread: '1H Spread',
  quarter_total: 'Quarter Total',
}

const CATEGORY_SORT_ORDER: Record<string, number> = {
  player_points: 1, player_rebounds: 2, player_assists: 3, player_threes: 4,
  player_pts_reb_ast: 5, player_steals: 6, player_blocks: 7,
  player_hits: 10, player_home_runs: 11, player_rbis: 12, player_strikeouts_p: 13,
  player_total_bases: 14, player_goals: 20, player_shots_on_goal: 21,
}

export function PropComparisonSection({ props }: PropComparisonSectionProps) {
  // Get available categories
  const categories = useMemo(() => {
    const cats = new Set(props.map(p => p.prop_category))
    return [...cats].sort((a, b) =>
      (CATEGORY_SORT_ORDER[a] ?? 99) - (CATEGORY_SORT_ORDER[b] ?? 99)
    )
  }, [props])

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const activeCategory = selectedCategory ?? categories[0] ?? null

  // Get sources (books)
  const sources = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; slug: string }>()
    for (const p of props) {
      if (!seen.has(p.source_id)) {
        seen.set(p.source_id, { id: p.source_id, name: p.source_name, slug: p.source_slug })
      }
    }
    return [...seen.values()]
  }, [props])

  // Filter props by selected category
  const filteredProps = useMemo(() => {
    if (!activeCategory) return []
    return props.filter(p => p.prop_category === activeCategory)
  }, [props, activeCategory])

  // Group by player + line
  const playerLines = useMemo(() => {
    const groups = new Map<string, Map<string, PropOdd>>()
    for (const p of filteredProps) {
      const key = `${p.player_name}|${p.line_value ?? 'null'}`
      if (!groups.has(key)) groups.set(key, new Map())
      groups.get(key)!.set(p.source_id, p)
    }
    return [...groups.entries()]
      .map(([key, sourceMap]) => {
        const [playerName, lineStr] = key.split('|')
        return {
          playerName,
          lineValue: lineStr === 'null' ? null : parseFloat(lineStr),
          bySource: sourceMap,
        }
      })
      .sort((a, b) => a.playerName.localeCompare(b.playerName))
  }, [filteredProps])

  if (categories.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-border bg-nb-900/40 px-6 py-8 text-center">
        <p className="text-sm text-nb-400">No prop data available for this event yet.</p>
        <p className="text-xs text-nb-500 mt-1">Props are scanned every 2 minutes from BetRivers and Pinnacle.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-4">
      <h2 className="text-sm font-semibold text-white">Player Props</h2>

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
              cat === activeCategory
                ? 'bg-violet-600 text-white'
                : 'bg-nb-800 text-nb-400 hover:text-white hover:bg-nb-700'
            }`}
          >
            {CATEGORY_LABELS[cat] ?? cat}
            <span className="ml-1 text-[10px] opacity-60">
              ({props.filter(p => p.prop_category === cat).length})
            </span>
          </button>
        ))}
      </div>

      {/* Comparison table */}
      {playerLines.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nb-800 bg-nb-900/60">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider sticky left-0 bg-nb-900/90 z-10">
                    Player
                  </th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                    Line
                  </th>
                  {sources.map(s => (
                    <th key={s.id} className="px-3 py-2 text-center text-[10px] font-semibold text-nb-400 uppercase tracking-wider" colSpan={2}>
                      {s.name}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-nb-800/50">
                  <th className="sticky left-0 bg-nb-900/90 z-10" />
                  <th />
                  {sources.map(s => (
                    <th key={s.id} colSpan={1} className="px-2 py-1 text-center">
                      <div className="flex">
                        <span className="flex-1 text-[9px] text-nb-500 font-normal">Over</span>
                        <span className="flex-1 text-[9px] text-nb-500 font-normal">Under</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {playerLines.map((pl) => {
                  // Find best over and under across books
                  let bestOver = -Infinity
                  let bestUnder = -Infinity
                  for (const [, p] of pl.bySource) {
                    if (p.over_price != null && p.over_price > bestOver) bestOver = p.over_price
                    if (p.under_price != null && p.under_price > bestUnder) bestUnder = p.under_price
                  }

                  return (
                    <tr key={`${pl.playerName}|${pl.lineValue}`} className="border-b border-border/30 hover:bg-nb-800/20">
                      <td className="px-3 py-2 text-xs text-white font-medium sticky left-0 bg-nb-950/90 z-10">
                        {pl.playerName}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-mono text-xs text-nb-300">
                          {pl.lineValue != null ? pl.lineValue : '—'}
                        </span>
                      </td>
                      {sources.map(s => {
                        const p = pl.bySource.get(s.id)
                        return (
                          <td key={s.id} className="px-2 py-2 text-center">
                            <div className="flex gap-2 justify-center">
                              <span className={`font-mono text-xs ${
                                p?.over_price != null && p.over_price === bestOver && sources.length > 1
                                  ? 'text-green-400 font-bold'
                                  : p?.over_price != null ? 'text-white' : 'text-nb-600'
                              }`}>
                                {p?.over_price != null ? formatOdds(p.over_price) : '—'}
                              </span>
                              <span className={`font-mono text-xs ${
                                p?.under_price != null && p.under_price === bestUnder && sources.length > 1
                                  ? 'text-green-400 font-bold'
                                  : p?.under_price != null ? 'text-white' : 'text-nb-600'
                              }`}>
                                {p?.under_price != null ? formatOdds(p.under_price) : '—'}
                              </span>
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
