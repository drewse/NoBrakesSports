'use client'

import { useState } from 'react'
import { ChevronDown, Clock } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import { formatOdds } from '@/lib/utils'
import type { BookColumn } from './odds-table'

export interface PlayerLineCell {
  sourceId: string
  line: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface PlayerPropRow {
  playerName: string
  /** Consensus line — most-quoted across books (ties: smallest). */
  consensusLine: number | null
  /** Per-source quotes, keyed by source_id. */
  byBook: Record<string, PlayerLineCell>
  bestOver: number | null
  bestUnder: number | null
  bestOverBook: string | null
  bestUnderBook: string | null
  avgOver: number | null
  avgUnder: number | null
  /** Live-update annotations — set of book ids whose cells should flicker. */
  _flickerCells?: Set<string>
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

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-nb-950">
      <div className="overflow-x-auto">
        <table className="text-sm border-separate" style={{ minWidth: '100%', borderSpacing: 0 }}>
          <thead>
            <tr className="border-b border-border bg-nb-950 text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
              <th className="sticky z-30 bg-nb-950 px-4 py-3 text-left" style={{ ...cellGame, left: 0 }}>Player</th>
              <th className="sticky z-30 bg-nb-950 px-3 py-3 text-center border-l border-nb-700" style={cellBest}>Best Odds</th>
              <th className="sticky z-30 bg-nb-950 px-3 py-3 text-center border-l border-r border-nb-700" style={cellAvg}>Avg Odds</th>
              {books.map(b => (
                <th key={b.id} className="px-2 py-3 text-center border-l border-border/40" style={{ minWidth: 92 }}>
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
}: {
  game: PropsGameRow
  books: BookColumn[]
  isOpen: boolean
  onToggle: () => void
  colSpan: number
  cellGame: React.CSSProperties
  cellBest: React.CSSProperties
  cellAvg:  React.CSSProperties
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
        <tr
          key={`${game.eventId}:${p.playerName}`}
          className="border-b border-border/30 bg-nb-950 hover:bg-nb-900"
        >
          <td className="sticky z-20 bg-inherit px-4 py-2.5 align-middle" style={{ ...cellGame, left: 0 }}>
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-white truncate">{p.playerName}</div>
              {p.consensusLine != null && (
                <div className="text-[10px] text-nb-500 font-mono">
                  O/U {p.consensusLine}
                </div>
              )}
            </div>
          </td>
          <td className="sticky z-20 bg-inherit px-3 py-2.5 text-center align-middle border-l border-nb-700" style={cellBest}>
            <OUStack over={p.bestOver} under={p.bestUnder} accentOver accentUnder />
          </td>
          <td className="sticky z-20 bg-inherit px-3 py-2.5 text-center align-middle border-l border-r border-nb-700" style={cellAvg}>
            <OUStack over={p.avgOver} under={p.avgUnder} />
          </td>
          {books.map(b => {
            const cell = p.byBook[b.id]
            const isBestOver  = cell?.overPrice  != null && p.bestOver  != null && cell.overPrice  === p.bestOver
            const isBestUnder = cell?.underPrice != null && p.bestUnder != null && cell.underPrice === p.bestUnder
            const flicker = p._flickerCells?.has(b.id)
            return (
              <td
                key={b.id}
                className={`px-2 py-2.5 text-center align-middle border-l border-border/40 ${flicker ? 'live-flicker' : ''}`}
                style={{ minWidth: 92 }}
              >
                <OUStack
                  over={cell?.overPrice ?? null}
                  under={cell?.underPrice ?? null}
                  accentOver={isBestOver}
                  accentUnder={isBestUnder}
                />
              </td>
            )
          })}
        </tr>
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

function OUStack({
  over, under, accentOver, accentUnder,
}: {
  over: number | null
  under: number | null
  accentOver?: boolean
  accentUnder?: boolean
}) {
  const overCls = over == null ? 'text-nb-700' : accentOver ? 'text-green-400 font-bold' : 'text-white'
  const underCls = under == null ? 'text-nb-700' : accentUnder ? 'text-green-400 font-bold' : 'text-white'
  return (
    <div className="flex flex-col items-center gap-0.5 font-mono">
      <span className={`text-xs ${overCls}`}>{over == null ? '—' : formatOdds(over)}</span>
      <span className={`text-xs ${underCls}`}>{under == null ? '—' : formatOdds(under)}</span>
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
