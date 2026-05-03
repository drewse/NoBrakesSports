'use client'

import { useState, useMemo } from 'react'
import { Clock, ChevronDown } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import { formatOdds } from '@/lib/utils'
import type { OddsRow, BookColumn } from './odds-table'
import type { PropsGameRow, PlayerPropRow, PlayerLineCell, PlayerLineSummary } from './props-table'
import type { MarketSelection } from '@/lib/odds/market-key'

/**
 * Mobile presentation of the /odds page.
 *
 * The desktop comparison table (28+ book columns × N games) is
 * unusable on a 375-430px viewport — even with horizontal scroll
 * inside the table, the user can't read across rows or compare
 * books at a glance. This component is a phone-friendly replacement:
 *
 *   • Each game = one card showing matchup + start time + best/avg odds.
 *   • Tap the card to expand a vertical list of every book's quote,
 *     with the best price on each side highlighted green.
 *   • No horizontal page scroll. Cards stack vertically, single column.
 *
 * Data shape is identical to the desktop table — both consume the
 * same rows / books from the loader, so business logic isn't
 * duplicated. This module is presentational only.
 */

// ── Game-line cards (moneyline / spread / total) ──────────────────

export function MobileGameOddsCards({
  selection, rows, books,
}: {
  selection: MarketSelection
  rows: OddsRow[]
  books: BookColumn[]
}) {
  const isOverUnder =
    selection.market === 'total'
    || selection.market === 'team_total'
    || selection.market === 'player_props'
  const topLabel = isOverUnder ? 'Over' : null
  const botLabel = isOverUnder ? 'Under' : null

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-12 text-center">
        <p className="text-sm text-nb-400">No matching odds.</p>
        <p className="text-xs text-nb-500 mt-1">
          Try a different market, period, or sport.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 pb-4">
      {rows.map(r => (
        <GameCard
          key={r.eventId}
          row={r}
          books={books}
          isOverUnder={isOverUnder}
          topLabel={topLabel}
          botLabel={botLabel}
        />
      ))}
    </div>
  )
}

function GameCard({
  row, books, isOverUnder, topLabel, botLabel,
}: {
  row: OddsRow
  books: BookColumn[]
  isOverUnder: boolean
  topLabel: string | null
  botLabel: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const animCls =
    row._anim === 'leaving' ? 'live-leaving-block' :
    row._anim === 'entering' ? 'live-entering-block' : ''

  // Books that actually quote this game (have a non-null price on
  // either side). Skips empty book columns so the expanded list
  // doesn't show 28 dashes.
  const quotingBooks = useMemo(() => {
    return books.filter(b => {
      const c = row.byBook[b.id]
      return c && (c.homePrice != null || c.awayPrice != null)
    })
  }, [books, row.byBook])

  return (
    <div className={`rounded-lg border border-nb-800 bg-nb-900 overflow-hidden ${animCls}`}>
      {/* Header — matchup + time + summary */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left px-3 py-3 active:bg-nb-800/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-nb-500 mb-1">{row.leagueAbbrev || ' '}</p>
            <p className="text-sm font-semibold text-white truncate leading-tight">{row.homeTeam}</p>
            <p className="text-sm font-semibold text-white truncate leading-tight">{row.awayTeam}</p>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-nb-500">
              <Clock className="h-2.5 w-2.5" />
              {formatStart(row.startTime)}
            </div>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-nb-400 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>

        {/* Best / Avg compact summary */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <SummaryCell
            label="Best"
            top={row.bestHome}
            bottom={row.bestAway}
            topLabel={isOverUnder ? topLabel : row.homeTeam.split(/\s+/).pop() ?? null}
            botLabel={isOverUnder ? botLabel : row.awayTeam.split(/\s+/).pop() ?? null}
            accent
          />
          <SummaryCell
            label="Avg"
            top={row.avgHome}
            bottom={row.avgAway}
          />
        </div>
      </button>

      {/* Expanded — per-book vertical list */}
      {expanded && (
        <div className="border-t border-nb-800 bg-nb-950/40 divide-y divide-border/30">
          {quotingBooks.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-nb-500">
              No book quotes on this market.
            </div>
          ) : quotingBooks.map(b => {
            const cell = row.byBook[b.id]
            const isBestTop    = cell?.homePrice != null && row.bestHome != null && cell.homePrice === row.bestHome
            const isBestBottom = cell?.awayPrice != null && row.bestAway != null && cell.awayPrice === row.bestAway
            return (
              <div key={b.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <BookLogo name={b.slug} size="sm" />
                  <span className="text-[11px] text-nb-200 truncate">{b.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 shrink-0 w-[140px] text-right">
                  <span className={`font-mono text-xs ${
                    cell?.homePrice == null ? 'text-nb-700' :
                    isBestTop ? 'text-green-400 font-bold' : 'text-white'
                  }`}>
                    {cell?.homePrice == null ? '—' : formatOdds(cell.homePrice)}
                  </span>
                  <span className={`font-mono text-xs ${
                    cell?.awayPrice == null ? 'text-nb-700' :
                    isBestBottom ? 'text-green-400 font-bold' : 'text-white'
                  }`}>
                    {cell?.awayPrice == null ? '—' : formatOdds(cell.awayPrice)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCell({
  label, top, bottom, topLabel, botLabel, accent,
}: {
  label: string
  top: number | null
  bottom: number | null
  topLabel?: string | null
  botLabel?: string | null
  accent?: boolean
}) {
  const cls = accent ? 'text-green-400 font-bold' : 'text-white'
  return (
    <div className="rounded-md bg-nb-800/60 border border-nb-700/50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-nb-500 mb-0.5">{label}</p>
      <div className="flex items-center justify-between text-[11px]">
        {topLabel && <span className="text-nb-400 truncate mr-1">{topLabel}</span>}
        <span className={`font-mono ${top == null ? 'text-nb-700' : cls}`}>
          {top == null ? '—' : formatOdds(top)}
        </span>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        {botLabel && <span className="text-nb-400 truncate mr-1">{botLabel}</span>}
        <span className={`font-mono ${bottom == null ? 'text-nb-700' : cls}`}>
          {bottom == null ? '—' : formatOdds(bottom)}
        </span>
      </div>
    </div>
  )
}

// ── Prop cards ────────────────────────────────────────────────────

export function MobilePropOddsCards({
  rows, books,
}: {
  rows: PropsGameRow[]
  books: BookColumn[]
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-12 text-center">
        <p className="text-sm text-nb-400">No matching player props.</p>
        <p className="text-xs text-nb-500 mt-1">
          Try a different stat, league, or time range.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 pb-4">
      {rows.map(g => <GamePropCard key={g.eventId} game={g} books={books} />)}
    </div>
  )
}

function GamePropCard({ game, books }: { game: PropsGameRow; books: BookColumn[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-nb-800 bg-nb-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-3 py-3 active:bg-nb-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate leading-tight">{game.homeTeam}</p>
            <p className="text-sm font-semibold text-white truncate leading-tight">{game.awayTeam}</p>
            <div className="flex items-center gap-1 mt-1 text-[10px] text-nb-500">
              <Clock className="h-2.5 w-2.5" />
              {formatStart(game.startTime)}
              <span className="ml-2 text-nb-600">{game.players.length} players</span>
            </div>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-nb-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>
      {open && (
        <div className="border-t border-nb-800 bg-nb-950/40">
          {game.players.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-nb-500">
              No props quoted.
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {game.players.map(p => (
                <PlayerPropMobile key={p.playerName} player={p} books={books} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PlayerPropMobile({ player, books }: { player: PlayerPropRow; books: BookColumn[] }) {
  const [open, setOpen] = useState(false)

  const summary: PlayerLineSummary = useMemo(() => {
    if (player.consensusLine == null) {
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
    }
    return player.linesByValue?.[String(player.consensusLine)] ?? {
      byBook: player.byBook,
      bestOver: player.bestOver,
      bestUnder: player.bestUnder,
      bestOverBook: player.bestOverBook,
      bestUnderBook: player.bestUnderBook,
      avgOver: player.avgOver,
      avgUnder: player.avgUnder,
      bookCount: Object.keys(player.byBook).length,
    }
  }, [player])

  const quotingBooks = useMemo(() => {
    return books.filter(b => {
      const c: PlayerLineCell | undefined = summary.byBook[b.id]
      return c && (c.overPrice != null || c.underPrice != null)
    })
  }, [books, summary.byBook])

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full text-left px-3 py-2.5 active:bg-nb-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">{player.playerName}</p>
            <p className="text-[10px] text-nb-500 mt-0.5">
              {player.consensusLine != null ? `Line ${player.consensusLine}` : 'Line —'}
              {' · '}{summary.bookCount} books
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 shrink-0 w-[140px] text-right">
            <span className={`font-mono text-xs ${summary.bestOver == null ? 'text-nb-700' : 'text-green-400 font-bold'}`}>
              {summary.bestOver == null ? '—' : formatOdds(summary.bestOver)}
            </span>
            <span className={`font-mono text-xs ${summary.bestUnder == null ? 'text-nb-700' : 'text-green-400 font-bold'}`}>
              {summary.bestUnder == null ? '—' : formatOdds(summary.bestUnder)}
            </span>
          </div>
          <ChevronDown
            className={`h-3.5 w-3.5 text-nb-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </div>
      </button>
      {open && (
        <div className="bg-nb-950/40 divide-y divide-border/20 border-t border-border/30">
          <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-1.5 text-[9px] uppercase tracking-wider text-nb-500">
            <span>Book</span>
            <span className="text-right w-[140px]">Over · Under</span>
          </div>
          {quotingBooks.map(b => {
            const cell = summary.byBook[b.id]
            const isBestOver  = cell?.overPrice  != null && summary.bestOver  != null && cell.overPrice  === summary.bestOver
            const isBestUnder = cell?.underPrice != null && summary.bestUnder != null && cell.underPrice === summary.bestUnder
            return (
              <div key={b.id} className="flex items-center gap-2 px-3 py-1.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <BookLogo name={b.slug} size="xs" />
                  <span className="text-[11px] text-nb-200 truncate">{b.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 shrink-0 w-[140px] text-right">
                  <span className={`font-mono text-xs ${
                    cell?.overPrice == null ? 'text-nb-700' :
                    isBestOver ? 'text-green-400 font-bold' : 'text-white'
                  }`}>
                    {cell?.overPrice == null ? '—' : formatOdds(cell.overPrice)}
                  </span>
                  <span className={`font-mono text-xs ${
                    cell?.underPrice == null ? 'text-nb-700' :
                    isBestUnder ? 'text-green-400 font-bold' : 'text-white'
                  }`}>
                    {cell?.underPrice == null ? '—' : formatOdds(cell.underPrice)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

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
