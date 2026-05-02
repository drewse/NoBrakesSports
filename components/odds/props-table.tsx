'use client'

import { memo, useMemo, useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import { formatOdds } from '@/lib/utils'
import { LineSelector, type LineOption } from './line-selector'
import type { BookColumn } from './odds-table'

export interface PlayerLineCell {
  sourceId: string
  line: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface PlayerPropRow {
  playerName: string
  /** Consensus line — most-quoted across books (ties: smallest).
   *  Used as the "Auto" selection. */
  consensusLine: number | null
  /** Per-source quotes for the CONSENSUS line (back-compat — what
   *  callers without alt-line awareness see). */
  byBook: Record<string, PlayerLineCell>
  bestOver: number | null
  bestUnder: number | null
  bestOverBook: string | null
  bestUnderBook: string | null
  avgOver: number | null
  avgUnder: number | null
  /** Per-line precomputed snapshots, keyed by line as a string ("21.5").
   *  Each entry is the same per-book/best/avg shape the row carries for
   *  the consensus line — switching the line selector swaps which entry
   *  the row renders without a network roundtrip. */
  linesByValue?: Record<string, PlayerLineSummary>
  /** Sorted ascending list of lines we have data for. */
  availableLines?: number[]
  /** Live-update annotations — bookId → per-side O/U price-move direction. */
  _flickerCells?: Map<string, { top?: 'up' | 'down'; bottom?: 'up' | 'down' }>
}

/**
 * One row's worth of per-book quotes + best/avg/coverage for a single
 * line value. The loader emits one of these per (player, line). The
 * client picks one to render based on the line-selector state.
 */
export interface PlayerLineSummary {
  byBook: Record<string, PlayerLineCell>
  bestOver: number | null
  bestUnder: number | null
  bestOverBook: string | null
  bestUnderBook: string | null
  avgOver: number | null
  avgUnder: number | null
  /** How many books quote this line — drives the "thin coverage" badge. */
  bookCount: number
}

export interface PropsGameRow {
  eventId: string
  title: string
  homeTeam: string
  awayTeam: string
  startTime: string
  players: PlayerPropRow[]
  /** Live-update animation state for the whole game block. */
  _anim?: 'entering' | 'leaving'
}

export function PropsTable({
  rows,
  books,
}: {
  rows: PropsGameRow[]
  books: BookColumn[]
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  // Same row+column hover affordance as OddsTable — see notes there.
  // hoveredCol tracks the book id under the cursor; row hover is
  // pure CSS (tr:hover) on each player row.
  const [hoveredCol, setHoveredCol] = useState<string | null>(null)

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-16 text-center">
        <p className="text-sm text-nb-400">No matching player props.</p>
        <p className="text-xs text-nb-500 mt-1">
          Try a different stat, league, or time range.
        </p>
      </div>
    )
  }

  const toggle = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const colSpan = 3 + books.length

  // See odds-table.tsx for rationale — exact pixel widths via inline
  // style so the sticky `left:` offsets line up with the actual column
  // widths.
  const W_GAME = 260
  const W_BEST = 110
  const W_AVG = 110
  const cellGame = { width: W_GAME, minWidth: W_GAME, maxWidth: W_GAME } as const
  const cellBest = { width: W_BEST, minWidth: W_BEST, maxWidth: W_BEST, left: W_GAME } as const
  const cellAvg  = { width: W_AVG,  minWidth: W_AVG,  maxWidth: W_AVG,  left: W_GAME + W_BEST } as const

  // Layout: same self-scrolling pattern as OddsTable. Outer card has
  // bounded height (h-full from page.tsx), inner div is the scroll
  // container with overflow on both axes, thead has top:0 sticky to
  // pin the book logos vertically while the user scrolls long player
  // lists.
  return (
    <div className="rounded-lg border border-border bg-nb-950 h-full">
      <div className="overflow-auto h-full">
        <table className="text-sm border-separate" style={{ minWidth: '100%', borderSpacing: 0 }}>
          <thead>
            <tr className="border-b border-border bg-nb-950 text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
              <th className="sticky z-40 bg-nb-950 px-4 py-3 text-left" style={{ ...cellGame, left: 0, top: 0 }}>Player</th>
              <th className="sticky z-40 bg-nb-950 px-3 py-3 text-center border-l border-nb-700" style={{ ...cellBest, top: 0 }}>Best Odds</th>
              <th className="sticky z-40 bg-nb-950 px-3 py-3 text-center border-l border-r border-nb-700" style={{ ...cellAvg, top: 0 }}>Avg Odds</th>
              {books.map(b => (
                <th
                  key={b.id}
                  className={`sticky z-20 px-2 py-3 text-center border-l border-border/40 ${
                    hoveredCol === b.id ? 'bg-blue-500/15' : 'bg-nb-950'
                  }`}
                  style={{ minWidth: 92, top: 0 }}
                  onMouseEnter={() => setHoveredCol(b.id)}
                  onMouseLeave={() => setHoveredCol(prev => prev === b.id ? null : prev)}
                >
                  <div className="flex justify-center">
                    <BookLogo name={b.slug} size="sm" />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(game => {
              const isOpen = openIds.has(game.eventId)
              return (
                <GameBlock
                  key={game.eventId}
                  game={game}
                  books={books}
                  isOpen={isOpen}
                  onToggle={() => toggle(game.eventId)}
                  colSpan={colSpan}
                  cellGame={cellGame}
                  cellBest={cellBest}
                  cellAvg={cellAvg}
                  hoveredCol={hoveredCol}
                  onHoverCol={setHoveredCol}
                />
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-nb-950 text-[10px] text-nb-500">
              <td className="sticky z-20 bg-nb-950 px-4 py-2 uppercase tracking-wider" style={{ ...cellGame, left: 0 }}>Over / Under</td>
              <td className="sticky z-20 bg-nb-950 border-l border-nb-700" style={cellBest} />
              <td className="sticky z-20 bg-nb-950 border-l border-r border-nb-700" style={cellAvg} />
              <td colSpan={books.length} className="px-3 py-2">
                {rows.length} game{rows.length === 1 ? '' : 's'} · {books.length} book{books.length === 1 ? '' : 's'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function GameBlock({
  game, books, isOpen, onToggle, colSpan, cellGame, cellBest, cellAvg,
  hoveredCol, onHoverCol,
}: {
  game: PropsGameRow
  books: BookColumn[]
  isOpen: boolean
  onToggle: () => void
  colSpan: number
  cellGame: React.CSSProperties
  cellBest: React.CSSProperties
  cellAvg:  React.CSSProperties
  /** AVO-style column highlight — see PropsTable for the source of truth. */
  hoveredCol: string | null
  onHoverCol: (id: string | null) => void
}) {
  const animCls =
    game._anim === 'leaving' ? 'live-leaving' :
    game._anim === 'entering' ? 'live-entering' : ''
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-border/40 bg-nb-900 hover:bg-nb-800 cursor-pointer ${animCls}`}
      >
        <td className="sticky z-20 bg-inherit px-4 py-3 align-middle" style={{ ...cellGame, left: 0 }}>
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-white truncate">{game.homeTeam}</div>
            <div className="text-xs font-medium text-white truncate">{game.awayTeam}</div>
            <div className="flex items-center gap-1 pt-1 text-[10px] text-nb-500">
              <Clock className="h-2.5 w-2.5" />
              {formatStart(game.startTime)}
            </div>
          </div>
        </td>
        <td className="sticky z-20 bg-inherit border-l border-nb-700" style={cellBest} />
        <td className="sticky z-20 bg-inherit border-l border-r border-nb-700" style={cellAvg} />
        <td colSpan={colSpan - 3} className="px-3 py-3">
          <div className="flex items-center justify-center gap-2 text-nb-400 hover:text-white transition-colors">
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
            <span className="text-sm font-semibold uppercase tracking-wider">
              {isOpen ? 'Close' : 'Open'}
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </td>
      </tr>

      {isOpen && game.players.map(p => (
        <PlayerRow
          key={`${game.eventId}:${p.playerName}`}
          player={p}
          books={books}
          cellGame={cellGame}
          cellBest={cellBest}
          cellAvg={cellAvg}
          hoveredCol={hoveredCol}
          onHoverCol={onHoverCol}
        />
      ))}

      {isOpen && game.players.length === 0 && (
        <tr className="border-b border-border/30 bg-nb-950">
          <td colSpan={colSpan} className="px-4 py-6 text-center text-xs text-nb-500">
            No props quoted for this game.
          </td>
        </tr>
      )}
    </>
  )
}

// ── PlayerRow ────────────────────────────────────────────────────────
// Memoized so switching one player's line doesn't re-render siblings.
// Owns its `selectedLine` state — null = "Auto" (consensus from loader).
const PlayerRow = memo(function PlayerRow({
  player, books, cellGame, cellBest, cellAvg, hoveredCol, onHoverCol,
}: {
  player: PlayerPropRow
  books: BookColumn[]
  cellGame: React.CSSProperties
  cellBest: React.CSSProperties
  cellAvg: React.CSSProperties
  hoveredCol: string | null
  onHoverCol: (id: string | null) => void
}) {
  // null = Auto (resolves to consensusLine from the loader)
  const [selectedLine, setSelectedLine] = useState<number | null>(null)

  // Resolve which line we're actually displaying right now.
  const effectiveLine = selectedLine ?? player.consensusLine

  // Pick the summary for that line. Falls back to the row's flat fields
  // (back-compat for callers that didn't set linesByValue yet).
  const summary = useMemo(() => {
    if (effectiveLine == null) return null
    const fromIndex = player.linesByValue?.[String(effectiveLine)]
    if (fromIndex) return fromIndex
    return {
      byBook: player.byBook,
      bestOver: player.bestOver,
      bestUnder: player.bestUnder,
      bestOverBook: player.bestOverBook,
      bestUnderBook: player.bestUnderBook,
      avgOver: player.avgOver,
      avgUnder: player.avgUnder,
      bookCount: Object.keys(player.byBook).length,
    }
  }, [effectiveLine, player])

  // Build LineSelector options from the row's available lines.
  const lineOptions: LineOption[] = useMemo(() => {
    const lines = player.availableLines ?? (player.consensusLine != null ? [player.consensusLine] : [])
    return lines.map(v => ({
      value: v,
      bookCount: player.linesByValue?.[String(v)]?.bookCount ?? 0,
    }))
  }, [player.availableLines, player.linesByValue, player.consensusLine])

  if (!summary) return null
  const { byBook, bestOver, bestUnder, avgOver, avgUnder } = summary

  return (
    <tr className="border-b border-border/30 bg-nb-950 hover:bg-blue-500/10">
      <td className="sticky z-20 bg-inherit px-4 py-2.5 align-middle" style={{ ...cellGame, left: 0 }}>
        <div className="space-y-1">
          <div className="text-xs font-medium text-white truncate">{player.playerName}</div>
          {effectiveLine != null && (
            <LineSelector
              lines={lineOptions}
              selected={selectedLine}
              autoLine={player.consensusLine}
              onChange={setSelectedLine}
              compact
            />
          )}
        </div>
      </td>
      <td className="sticky z-20 bg-inherit px-3 py-2.5 text-center align-middle border-l border-nb-700" style={cellBest}>
        <OUStack over={bestOver} under={bestUnder} accentOver accentUnder />
      </td>
      <td className="sticky z-20 bg-inherit px-3 py-2.5 text-center align-middle border-l border-r border-nb-700" style={cellAvg}>
        <OUStack over={avgOver} under={avgUnder} />
      </td>
      {books.map(b => {
        const cell = byBook[b.id]
        const isBestOver  = cell?.overPrice  != null && bestOver  != null && cell.overPrice  === bestOver
        const isBestUnder = cell?.underPrice != null && bestUnder != null && cell.underPrice === bestUnder
        // Flicker only fires when we're on the consensus line — that's
        // the line the SWR diff layer compares against. Switching to an
        // alt line shows static prices until the next poll.
        const onConsensus = selectedLine == null || selectedLine === player.consensusLine
        const move = onConsensus ? player._flickerCells?.get(b.id) : undefined
        const isHoveredCol = hoveredCol === b.id
        return (
          <td
            key={b.id}
            className={`px-2 py-2.5 text-center align-middle border-l border-border/40 ${
              isHoveredCol ? 'bg-blue-500/15' : ''
            }`}
            style={{ minWidth: 92 }}
            onMouseEnter={() => onHoverCol(b.id)}
            onMouseLeave={() => onHoverCol(b.id === hoveredCol ? null : hoveredCol)}
          >
            <OUStack
              over={cell?.overPrice ?? null}
              under={cell?.underPrice ?? null}
              accentOver={isBestOver}
              accentUnder={isBestUnder}
              flickerOver={move?.top}
              flickerUnder={move?.bottom}
            />
          </td>
        )
      })}
    </tr>
  )
})

function OUStack({
  over, under, accentOver, accentUnder, flickerOver, flickerUnder,
}: {
  over: number | null
  under: number | null
  accentOver?: boolean
  accentUnder?: boolean
  flickerOver?: 'up' | 'down'
  flickerUnder?: 'up' | 'down'
}) {
  const overCls = over == null ? 'text-nb-700' : accentOver ? 'text-green-400 font-bold' : 'text-white'
  const underCls = under == null ? 'text-nb-700' : accentUnder ? 'text-green-400 font-bold' : 'text-white'
  const overFlick = flickerOver === 'up' ? 'live-flash-up' : flickerOver === 'down' ? 'live-flash-down' : ''
  const underFlick = flickerUnder === 'up' ? 'live-flash-up' : flickerUnder === 'down' ? 'live-flash-down' : ''
  return (
    <div className="flex flex-col items-center gap-0.5 font-mono">
      <span className={`text-xs ${overCls} ${overFlick}`}>{over == null ? '—' : formatOdds(over)}</span>
      <span className={`text-xs ${underCls} ${underFlick}`}>{under == null ? '—' : formatOdds(under)}</span>
    </div>
  )
}

function formatStart(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${date} ${time}`
}
