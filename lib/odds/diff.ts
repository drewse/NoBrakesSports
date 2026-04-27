// Pure diff helpers for live-polling annotations on the odds tables.
// Used by odds-client to mark new / removed / changed rows so the
// server payloads stay JSON-clean and the client owns animation state.

import type { OddsRow } from '@/components/odds/odds-table'
import type { PropsGameRow, PlayerPropRow } from '@/components/odds/props-table'

export type SideMove = 'up' | 'down'

export interface RowDiff<R> {
  added: R[]
  removedIds: string[]
  /** rowId → bookId → { top?: 'up'|'down'; bottom?: 'up'|'down' } */
  changed: Map<string, Map<string, { top?: SideMove; bottom?: SideMove }>>
}

export function diffGameRows(prev: OddsRow[], next: OddsRow[]): RowDiff<OddsRow> {
  const prevById = new Map(prev.map(r => [r.eventId, r]))
  const nextById = new Map(next.map(r => [r.eventId, r]))

  const added: OddsRow[] = []
  for (const r of next) if (!prevById.has(r.eventId)) added.push(r)

  const removedIds: string[] = []
  for (const r of prev) if (!nextById.has(r.eventId)) removedIds.push(r.eventId)

  // For each cell whose price moved, record direction PER SIDE (top/bottom)
  // independently — the home leg can improve while the away leg gets worse.
  // Interpretation: in American odds, a more positive number is a better
  // payout for the bettor, so price↑ = "better" (green), price↓ = "worse" (red).
  const changed = new Map<string, Map<string, { top?: SideMove; bottom?: SideMove }>>()
  for (const r of next) {
    const old = prevById.get(r.eventId)
    if (!old) continue
    const perBook = new Map<string, { top?: SideMove; bottom?: SideMove }>()
    const allBookIds = new Set<string>([
      ...Object.keys(old.byBook),
      ...Object.keys(r.byBook),
    ])
    for (const bid of allBookIds) {
      const a = old.byBook[bid]
      const b = r.byBook[bid]
      const oldTop = a?.homePrice ?? null
      const newTop = b?.homePrice ?? null
      const oldBot = a?.awayPrice ?? null
      const newBot = b?.awayPrice ?? null
      const moves: { top?: SideMove; bottom?: SideMove } = {}
      if (oldTop != null && newTop != null && oldTop !== newTop) {
        moves.top = newTop > oldTop ? 'up' : 'down'
      }
      if (oldBot != null && newBot != null && oldBot !== newBot) {
        moves.bottom = newBot > oldBot ? 'up' : 'down'
      }
      if (moves.top || moves.bottom) perBook.set(bid, moves)
    }
    if (perBook.size > 0) changed.set(r.eventId, perBook)
  }

  return { added, removedIds, changed }
}

export function isGameDiffEmpty(d: RowDiff<OddsRow>): boolean {
  return d.added.length === 0 && d.removedIds.length === 0 && d.changed.size === 0
}

/**
 * Props diff treats each (eventId, playerName) as the row identity. Returns
 * a flat structure plus a per-game animation state so the GameBlock can
 * stay mounted while individual player rows enter/leave.
 */
export interface PropsDiff {
  addedGames: PropsGameRow[]
  removedGameIds: string[]
  /** eventId → playerName → bookId → per-side moves */
  changed: Map<string, Map<string, Map<string, { top?: SideMove; bottom?: SideMove }>>>
}

function playerKey(eventId: string, name: string) { return `${eventId}::${name}` }

export function diffPropsRows(prev: PropsGameRow[], next: PropsGameRow[]): PropsDiff {
  const prevByGame = new Map(prev.map(g => [g.eventId, g]))
  const nextByGame = new Map(next.map(g => [g.eventId, g]))

  const addedGames = next.filter(g => !prevByGame.has(g.eventId))
  const removedGameIds = prev.filter(g => !nextByGame.has(g.eventId)).map(g => g.eventId)

  const changed = new Map<string, Map<string, Map<string, { top?: SideMove; bottom?: SideMove }>>>()
  for (const g of next) {
    const old = prevByGame.get(g.eventId)
    if (!old) continue
    const oldByPlayer = new Map(old.players.map(p => [p.playerName, p]))
    const perPlayer = new Map<string, Map<string, { top?: SideMove; bottom?: SideMove }>>()
    for (const p of g.players) {
      const op = oldByPlayer.get(p.playerName)
      if (!op) continue
      const allBookIds = new Set<string>([
        ...Object.keys(op.byBook),
        ...Object.keys(p.byBook),
      ])
      const perBook = new Map<string, { top?: SideMove; bottom?: SideMove }>()
      for (const bid of allBookIds) {
        const a = op.byBook[bid]
        const b = p.byBook[bid]
        const oldOver  = a?.overPrice ?? null
        const newOver  = b?.overPrice ?? null
        const oldUnder = a?.underPrice ?? null
        const newUnder = b?.underPrice ?? null
        const moves: { top?: SideMove; bottom?: SideMove } = {}
        if (oldOver != null && newOver != null && oldOver !== newOver) {
          moves.top = newOver > oldOver ? 'up' : 'down'
        }
        if (oldUnder != null && newUnder != null && oldUnder !== newUnder) {
          moves.bottom = newUnder > oldUnder ? 'up' : 'down'
        }
        if (moves.top || moves.bottom) perBook.set(bid, moves)
      }
      if (perBook.size > 0) perPlayer.set(p.playerName, perBook)
    }
    if (perPlayer.size > 0) changed.set(g.eventId, perPlayer)
  }

  return { addedGames, removedGameIds, changed }
}

export function isPropsDiffEmpty(d: PropsDiff): boolean {
  return d.addedGames.length === 0 && d.removedGameIds.length === 0 && d.changed.size === 0
}
