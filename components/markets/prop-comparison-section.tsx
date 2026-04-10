'use client'

import { useState, useMemo, Fragment } from 'react'
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

/** Returns true if this prop row has real over/under data (not just a binary yes/no) */
function isOverUnderProp(p: PropOdd): boolean {
  return p.over_price != null || p.under_price != null
}

export function PropComparisonSection({ props }: PropComparisonSectionProps) {
  // Only show over/under props — filter out binary (yes/no) props that have no O/U prices
  const ouProps = useMemo(() => props.filter(isOverUnderProp), [props])

  // Get available categories from O/U props only
  const categories = useMemo(() => {
    const cats = new Set(ouProps.map(p => p.prop_category))
    return [...cats].sort((a, b) =>
      (CATEGORY_SORT_ORDER[a] ?? 99) - (CATEGORY_SORT_ORDER[b] ?? 99)
    )
  }, [ouProps])

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const activeCategory = selectedCategory ?? categories[0] ?? null

  // Get sources (books)
  const sources = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; slug: string }>()
    for (const p of ouProps) {
      if (!seen.has(p.source_id)) {
        seen.set(p.source_id, { id: p.source_id, name: p.source_name, slug: p.source_slug })
      }
    }
    return [...seen.values()]
  }, [ouProps])

  // Filter props by selected category
  const filteredProps = useMemo(() => {
    if (!activeCategory) return []
    return ouProps.filter(p => p.prop_category === activeCategory)
  }, [ouProps, activeCategory])

  // Group by player — one row per player showing their main line per book
  const playerRows = useMemo(() => {
    // Group: player → source → prop (keep the one with the most "standard" line)
    const byPlayer = new Map<string, Map<string, PropOdd>>()

    for (const p of filteredProps) {
      if (!byPlayer.has(p.player_name)) byPlayer.set(p.player_name, new Map())
      const sourceMap = byPlayer.get(p.player_name)!
      const existing = sourceMap.get(p.source_id)
      // Keep the prop with a line_value (prefer non-null), or if both have one, keep first
      if (!existing || (existing.line_value == null && p.line_value != null)) {
        sourceMap.set(p.source_id, p)
      }
    }

    return [...byPlayer.entries()]
      .map(([playerName, sourceMap]) => ({ playerName, bySource: sourceMap }))
      .sort((a, b) => a.playerName.localeCompare(b.playerName))
  }, [filteredProps])

  // Count O/U props per category for pill badges
  const countByCategory = useMemo(() => {
    const counts = new Map<string, number>()
    // Count unique players per category (not raw row count)
    for (const cat of categories) {
      const players = new Set(ouProps.filter(p => p.prop_category === cat).map(p => p.player_name))
      counts.set(cat, players.size)
    }
    return counts
  }, [ouProps, categories])

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
              ({countByCategory.get(cat) ?? 0})
            </span>
          </button>
        ))}
      </div>

      {/* Comparison table */}
      {playerRows.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nb-800 bg-nb-900/60">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider sticky left-0 bg-nb-900/90 z-10 min-w-[140px]">
                    Player
                  </th>
                  {sources.map(s => (
                    <>
                      <th key={`${s.id}-l`} className="px-2 py-2 text-center text-[10px] font-semibold text-nb-500 uppercase tracking-wider w-[60px]">
                        Line
                      </th>
                      <th key={`${s.id}-o`} className="px-2 py-2 text-center text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-[70px]">
                        Over
                      </th>
                      <th key={`${s.id}-u`} className="px-2 py-2 text-center text-[10px] font-semibold text-nb-400 uppercase tracking-wider w-[70px]">
                        Under
                      </th>
                    </>
                  ))}
                </tr>
                {/* Source name row */}
                <tr className="border-b border-nb-800/50">
                  <th className="sticky left-0 bg-nb-900/90 z-10" />
                  {sources.map(s => (
                    <th key={s.id} colSpan={3} className="px-2 py-1 text-center text-[10px] font-semibold text-nb-300 uppercase tracking-wider">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {playerRows.map((pl) => {
                  // Find best over and under across books for highlighting
                  let bestOver = -Infinity
                  let bestUnder = -Infinity
                  for (const [, p] of pl.bySource) {
                    if (p.over_price != null && p.over_price > bestOver) bestOver = p.over_price
                    if (p.under_price != null && p.under_price > bestUnder) bestUnder = p.under_price
                  }

                  return (
                    <tr key={pl.playerName} className="border-b border-border/30 hover:bg-nb-800/20">
                      <td className="px-3 py-2 text-xs text-white font-medium sticky left-0 bg-nb-950/90 z-10 whitespace-nowrap">
                        {pl.playerName}
                      </td>
                      {sources.map(s => {
                        const p = pl.bySource.get(s.id)
                        return (
                          <Fragment key={s.id}>
                            <td className="px-2 py-2 text-center">
                              <span className="font-mono text-xs text-nb-400">
                                {p?.line_value != null ? p.line_value : '—'}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={`font-mono text-xs ${
                                p?.over_price != null && p.over_price === bestOver && sources.length > 1
                                  ? 'text-green-400 font-bold'
                                  : p?.over_price != null ? 'text-white' : 'text-nb-600'
                              }`}>
                                {p?.over_price != null ? formatOdds(p.over_price) : '—'}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span className={`font-mono text-xs ${
                                p?.under_price != null && p.under_price === bestUnder && sources.length > 1
                                  ? 'text-green-400 font-bold'
                                  : p?.under_price != null ? 'text-white' : 'text-nb-600'
                              }`}>
                                {p?.under_price != null ? formatOdds(p.under_price) : '—'}
                              </span>
                            </td>
                          </Fragment>
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
