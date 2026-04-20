'use client'

import { useState, useMemo, Fragment } from 'react'
import { ChevronDown } from 'lucide-react'
import { formatOdds } from '@/lib/utils'
import { BookLogo } from '@/components/shared/book-logo'

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
  player_pts_reb: 'PTS+REB',
  player_pts_ast: 'PTS+AST',
  player_ast_reb: 'REB+AST',
  player_steals: 'Steals',
  player_blocks: 'Blocks',
  player_turnovers: 'Turnovers',
  player_steals_blocks: 'STL+BLK',
  player_double_double: 'Double-Double',
  player_triple_double: 'Triple-Double',
  player_hits: 'Hits',
  player_home_runs: 'Home Runs',
  player_rbis: 'RBIs',
  player_strikeouts_p: 'Pitcher Ks',
  player_total_bases: 'Total Bases',
  player_runs: 'Runs',
  player_stolen_bases: 'Stolen Bases',
  player_walks: 'Walks',
  player_hits_allowed: 'Hits Allowed',
  player_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs',
  player_singles: 'Singles',
  player_doubles: 'Doubles',
  player_triples: 'Triples',
  player_extra_base_hits: 'Extra Base Hits',
  player_hits_runs_rbis: 'H+R+RBI',
  player_goals: 'Goals',
  player_shots_on_goal: 'Shots on Goal',
  player_saves: 'Saves',
  player_hockey_assists: 'Assists',
  player_hockey_points: 'Points',
  player_power_play_pts: 'PPP',
  player_soccer_goals: 'Goals',
  player_shots_target: 'SOT',
  game_total_hits: 'Game Total Hits',
}

const CATEGORY_SORT_ORDER: Record<string, number> = {
  player_points: 1, player_rebounds: 2, player_assists: 3, player_threes: 4,
  player_pts_reb_ast: 5, player_pts_reb: 6, player_pts_ast: 7, player_ast_reb: 8,
  player_steals: 9, player_blocks: 10, player_steals_blocks: 11, player_turnovers: 12,
  player_hits: 20, player_home_runs: 21, player_rbis: 22, player_total_bases: 23,
  player_runs: 24, player_stolen_bases: 25, player_walks: 26,
  player_singles: 27, player_doubles: 28, player_triples: 29, player_extra_base_hits: 30,
  player_hits_runs_rbis: 31,
  player_strikeouts_p: 35, player_earned_runs: 36, pitcher_outs: 37, player_hits_allowed: 38,
  player_goals: 40, player_hockey_assists: 41, player_hockey_points: 42,
  player_shots_on_goal: 43, player_saves: 44, player_power_play_pts: 45,
  player_soccer_goals: 50, player_shots_target: 51,
}

/** Returns true if this prop row has real over/under data (not just a binary yes/no) */
function isOverUnderProp(p: PropOdd): boolean {
  return p.over_price != null || p.under_price != null
}

export function PropComparisonSection({ props }: PropComparisonSectionProps) {
  const ouProps = useMemo(() => props.filter(isOverUnderProp), [props])

  // Sources present across ALL props (column set for inner tables)
  const allSources = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; slug: string }>()
    for (const p of ouProps) {
      if (!seen.has(p.source_id)) {
        seen.set(p.source_id, { id: p.source_id, name: p.source_name, slug: p.source_slug })
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [ouProps])

  // Organize by player → category → line → source
  type LineRow = { line: number; bySource: Map<string, PropOdd> }
  type CategoryData = { category: string; lines: LineRow[] }
  type PlayerData = { playerName: string; categories: CategoryData[] }

  const playerData = useMemo<PlayerData[]>(() => {
    // player → category → line(number|null sentinel) → source → prop
    const byPlayer = new Map<string, Map<string, Map<number, Map<string, PropOdd>>>>()
    for (const p of ouProps) {
      if (!byPlayer.has(p.player_name)) byPlayer.set(p.player_name, new Map())
      const catMap = byPlayer.get(p.player_name)!
      if (!catMap.has(p.prop_category)) catMap.set(p.prop_category, new Map())
      const lineMap = catMap.get(p.prop_category)!
      const lineKey = p.line_value ?? NaN
      if (!lineMap.has(lineKey)) lineMap.set(lineKey, new Map())
      const srcMap = lineMap.get(lineKey)!
      const existing = srcMap.get(p.source_id)
      // If duplicate (shouldn't happen — upserts dedup) keep the more recent one.
      if (!existing || p.snapshot_time > existing.snapshot_time) srcMap.set(p.source_id, p)
    }

    const toPlayerData = (
      playerName: string,
      catMap: Map<string, Map<number, Map<string, PropOdd>>>,
    ): PlayerData => {
      const categories: CategoryData[] = []
      for (const [category, lineMap] of catMap) {
        const lines: LineRow[] = []
        for (const [line, bySource] of lineMap) {
          if (Number.isNaN(line)) continue
          lines.push({ line, bySource })
        }
        lines.sort((a, b) => a.line - b.line)
        if (lines.length > 0) categories.push({ category, lines })
      }
      categories.sort(
        (a, b) => (CATEGORY_SORT_ORDER[a.category] ?? 99) - (CATEGORY_SORT_ORDER[b.category] ?? 99),
      )
      return { playerName, categories }
    }

    return [...byPlayer.entries()]
      .map(([n, c]) => toPlayerData(n, c))
      .filter(p => p.categories.length > 0)
      .sort((a, b) => a.playerName.localeCompare(b.playerName))
  }, [ouProps])

  const [openPlayers, setOpenPlayers] = useState<Set<string>>(new Set())
  const [activeCategoryByPlayer, setActiveCategoryByPlayer] = useState<Map<string, string>>(new Map())

  const togglePlayer = (name: string) => {
    setOpenPlayers(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const setActiveCategory = (player: string, cat: string) => {
    setActiveCategoryByPlayer(prev => {
      const next = new Map(prev)
      next.set(player, cat)
      return next
    })
  }

  if (playerData.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-border bg-nb-900/40 px-6 py-8 text-center">
        <p className="text-sm text-nb-400">No prop data available for this event yet.</p>
        <p className="text-xs text-nb-500 mt-1">Props refresh every 2 minutes.</p>
      </div>
    )
  }

  return (
    <div className="mt-6 space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Player Props</h2>
        <p className="text-[11px] text-nb-500">{playerData.length} players</p>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        {playerData.map((player, idx) => {
          const isOpen = openPlayers.has(player.playerName)
          const activeCat = activeCategoryByPlayer.get(player.playerName) ?? player.categories[0].category
          const active = player.categories.find(c => c.category === activeCat) ?? player.categories[0]

          return (
            <div
              key={player.playerName}
              className={`${idx > 0 ? 'border-t border-border/40' : ''} ${isOpen ? 'bg-nb-900/40' : ''}`}
            >
              <button
                type="button"
                onClick={() => togglePlayer(player.playerName)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-nb-800/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ChevronDown
                    className={`h-4 w-4 text-nb-500 shrink-0 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`}
                  />
                  <span className="text-sm font-medium text-white truncate">{player.playerName}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-nb-500 uppercase tracking-wider">
                    {player.categories.length} {player.categories.length === 1 ? 'market' : 'markets'}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 space-y-3">
                  {/* Category tabs */}
                  <div className="flex flex-wrap gap-1.5">
                    {player.categories.map(cat => (
                      <button
                        key={cat.category}
                        onClick={() => setActiveCategory(player.playerName, cat.category)}
                        className={`px-3 py-1 text-[11px] font-medium rounded-full transition-colors ${
                          cat.category === active.category
                            ? 'bg-violet-600 text-white'
                            : 'bg-nb-800 text-nb-400 hover:text-white hover:bg-nb-700'
                        }`}
                      >
                        {CATEGORY_LABELS[cat.category] ?? cat.category}
                        <span className="ml-1 text-[10px] opacity-60">({cat.lines.length})</span>
                      </button>
                    ))}
                  </div>

                  {/* Per-line table */}
                  <div className="rounded-lg border border-border/60 overflow-hidden bg-nb-950/40">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-nb-800 bg-nb-900/60">
                            <th className="px-3 py-2 text-left text-[10px] font-semibold text-nb-500 uppercase tracking-wider sticky left-0 bg-nb-900/90 z-10 w-[60px]">
                              Line
                            </th>
                            {allSources.map(s => (
                              <th key={s.id} colSpan={2} className="px-2 py-2 text-center border-l border-nb-800/40">
                                <div className="flex justify-center mb-1">
                                  <BookLogo name={s.slug ?? s.name} size="sm" />
                                </div>
                                <div className="flex items-center justify-center gap-2">
                                  <span className="text-[9px] font-semibold text-nb-500 uppercase w-[48px]">Over</span>
                                  <span className="text-[9px] font-semibold text-nb-500 uppercase w-[48px]">Under</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {active.lines.map(lineRow => {
                            // Best over / under across books at this specific line for highlight
                            let bestOver = -Infinity
                            let bestUnder = -Infinity
                            for (const [, p] of lineRow.bySource) {
                              if (p.over_price != null && p.over_price > bestOver) bestOver = p.over_price
                              if (p.under_price != null && p.under_price > bestUnder) bestUnder = p.under_price
                            }
                            return (
                              <tr key={lineRow.line} className="border-b border-border/20 hover:bg-nb-800/20">
                                <td className="px-3 py-2 text-left sticky left-0 bg-nb-950/90 z-10 font-mono text-xs text-white">
                                  {lineRow.line}
                                </td>
                                {allSources.map(s => {
                                  const p = lineRow.bySource.get(s.id)
                                  const over = p?.over_price
                                  const under = p?.under_price
                                  return (
                                    <Fragment key={s.id}>
                                      <td className="px-2 py-2 text-center border-l border-nb-800/40">
                                        <span
                                          className={`font-mono text-xs ${
                                            over != null && over === bestOver && allSources.length > 1
                                              ? 'text-green-400 font-bold'
                                              : over != null
                                              ? 'text-white'
                                              : 'text-nb-700'
                                          }`}
                                        >
                                          {over != null ? formatOdds(over) : '—'}
                                        </span>
                                      </td>
                                      <td className="px-2 py-2 text-center">
                                        <span
                                          className={`font-mono text-xs ${
                                            under != null && under === bestUnder && allSources.length > 1
                                              ? 'text-green-400 font-bold'
                                              : under != null
                                              ? 'text-white'
                                              : 'text-nb-700'
                                          }`}
                                        >
                                          {under != null ? formatOdds(under) : '—'}
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
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
