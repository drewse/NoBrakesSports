'use client'

import { Clock } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import { formatOdds } from '@/lib/utils'
import type { MarketSelection } from '@/lib/odds/market-key'

export interface OddsCell {
  sourceId: string
  homePrice: number | null   // or overPrice for over/under shapes
  awayPrice: number | null   // or underPrice
}

export interface OddsRow {
  eventId: string
  title: string
  homeTeam: string
  awayTeam: string
  startTime: string
  leagueAbbrev: string
  /** Per-source odds keyed by source_id. */
  byBook: Map<string, OddsCell>
  /** Pre-computed best and average across books. */
  bestHome: number | null
  bestAway: number | null
  bestHomeBook: string | null
  bestAwayBook: string | null
  avgHome: number | null
  avgAway: number | null
}

export interface BookColumn {
  id: string
  name: string
  slug: string
}

/**
 * OddsJam-style comparison table. Rows are games, columns are books.
 * Left-frozen section: matchup, start time, best odds, average odds.
 * Right scrollable: a cell per book with home/away (or over/under)
 * stacked.
 */
export function OddsTable({
  selection,
  rows,
  books,
}: {
  selection: MarketSelection
  rows: OddsRow[]
  books: BookColumn[]
}) {
  const isOverUnder = selection.market === 'total'
    || selection.market === 'team_total'
    || selection.market === 'player_props'
  const topLabel = isOverUnder ? 'OVER' : 'HOME'
  const botLabel = isOverUnder ? 'UNDER' : 'AWAY'

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-16 text-center">
        <p className="text-sm text-nb-400">No matching odds.</p>
        <p className="text-xs text-nb-500 mt-1">
          Try a different market, period, or sport.
        </p>
      </div>
    )
  }

  // Frozen-group widths. Used as inline style + matching `left:` offsets
  // so the first three columns render at EXACTLY these pixel widths
  // regardless of table content. Tailwind `w-[260px]` is just a hint;
  // a `w-full` table will reflow it and break the sticky offsets.
  const W_GAME = 260
  const W_BEST = 110
  const W_AVG = 110
  const cellGame = { width: W_GAME, minWidth: W_GAME, maxWidth: W_GAME } as const
  const cellBest = { width: W_BEST, minWidth: W_BEST, maxWidth: W_BEST, left: W_GAME } as const
  const cellAvg  = { width: W_AVG,  minWidth: W_AVG,  maxWidth: W_AVG,  left: W_GAME + W_BEST } as const

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-nb-950">
      <div className="overflow-x-auto">
        <table className="text-sm border-collapse" style={{ minWidth: '100%' }}>
          <thead>
            <tr className="border-b border-border bg-nb-950 text-[10px] font-semibold text-nb-500 uppercase tracking-wider">
              <th className="sticky z-30 bg-nb-950 px-4 py-3 text-left" style={{ ...cellGame, left: 0 }}>Game</th>
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
            {rows.map((r, idx) => (
              <tr
                key={r.eventId}
                className={`border-b border-border/40 ${idx % 2 === 0 ? 'bg-nb-950' : 'bg-nb-900'}`}
              >
                <td className="sticky z-20 bg-inherit px-4 py-3 align-middle" style={{ ...cellGame, left: 0 }}>
                  <div className="space-y-0.5">
                    <div className="text-xs font-medium text-white truncate">{r.homeTeam}</div>
                    <div className="text-xs font-medium text-white truncate">{r.awayTeam}</div>
                    <div className="flex items-center gap-1 pt-1 text-[10px] text-nb-500">
                      <Clock className="h-2.5 w-2.5" />
                      {formatStart(r.startTime)}
                    </div>
                  </div>
                </td>
                <td className="sticky z-20 bg-inherit px-3 py-3 text-center align-middle border-l border-nb-700" style={cellBest}>
                  <OddsStack top={r.bestHome} bottom={r.bestAway} accent />
                </td>
                <td className="sticky z-20 bg-inherit px-3 py-3 text-center align-middle border-l border-r border-nb-700" style={cellAvg}>
                  <OddsStack top={r.avgHome} bottom={r.avgAway} />
                </td>
                {books.map(b => {
                  const cell = r.byBook.get(b.id)
                  return (
                    <td key={b.id} className="px-2 py-3 text-center align-middle border-l border-border/40" style={{ minWidth: 92 }}>
                      <OddsStack top={cell?.homePrice ?? null} bottom={cell?.awayPrice ?? null} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-nb-950 text-[10px] text-nb-500">
              <td className="sticky z-20 bg-nb-950 px-4 py-2 uppercase tracking-wider" style={{ ...cellGame, left: 0 }}>{topLabel} / {botLabel}</td>
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

function OddsStack({
  top, bottom, accent,
}: {
  top: number | null
  bottom: number | null
  accent?: boolean
}) {
  const topCls = top == null ? 'text-nb-700' : accent ? 'text-green-400 font-bold' : 'text-white'
  const botCls = bottom == null ? 'text-nb-700' : accent ? 'text-green-400 font-bold' : 'text-white'
  return (
    <div className="flex flex-col items-center gap-0.5 font-mono">
      <span className={`text-xs ${topCls}`}>{top == null ? '—' : formatOdds(top)}</span>
      <span className={`text-xs ${botCls}`}>{bottom == null ? '—' : formatOdds(bottom)}</span>
    </div>
  )
}

function formatStart(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // e.g. "Today 7:10 PM" / "Apr 25 3:35 PM"
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${date} ${time}`
}
