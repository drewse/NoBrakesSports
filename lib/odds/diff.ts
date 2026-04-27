// Pure diff helpers for live-polling annotations on the odds tables.
// Used by odds-client to mark new / removed / changed rows so the
// server payloads stay JSON-clean and the client owns animation state.

import type { OddsRow } from '@/components/odds/odds-table'
import type { PropsGameRow, PlayerPropRow } from '@/components/odds/props-table'

export interface RowDiff<R> {
  added: R[]
  removedIds: string[]
  /** rowId → set of cell keys (e.g. book ids) that changed value */
  changed: Map<string, Set<string>>
}

export function diffGameRows(prev: OddsRow[], next: OddsRow[]): RowDiff<OddsRow> {
  const prevById = new Map(prev.map(r => [r.eventId, r]))
  const nextById = new Map(next.map(r => [r.eventId, r]))

  const added: OddsRow[] = []
  for (const r of next) if (!prevById.has(r.eventId)) added.push(r)

  const removedIds: string[] = []
  for (const r of prev) if (!nextById.has(r.eventId)) removedIds.push(r.eventId)

  const changed = new Map<string, Set<string>>()
  for (const r of next) {
    const old = prevById.get(r.eventId)
    if (!old) continue
    const cells = new Set<string>()
    const allBookIds = new Set<string>([
      ...Object.keys(old.byBook),
      ...Object.keys(r.byBook),
    ])
    for (const bid of allBookIds) {
      const a = old.byBook[bid]
      const b = r.byBook[bid]
      if ((a?.homePrice ?? null) !== (b?.homePrice ?? null) ||
          (a?.awayPrice ?? null) !== (b?.awayPrice ?? null)) {
        cells.add(bid)
      }
    }
    if (cells.size > 0) changed.set(r.eventId, cells)
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
  /** eventId → Set of bookIds whose cells changed (any player). */
  changed: Map<string, Map<string, Set<string>>>  // eventId → playerName → bookIds
}

function playerKey(eventId: string, name: string) { return `${eventId}::${name}` }

export function diffPropsRows(prev: PropsGameRow[], next: PropsGameRow[]): PropsDiff {
  const prevByGame = new Map(prev.map(g => [g.eventId, g]))
  const nextByGame = new Map(next.map(g => [g.eventId, g]))

  const addedGames = next.filter(g => !prevByGame.has(g.eventId))
  const removedGameIds = prev.filter(g => !nextByGame.has(g.eventId)).map(g => g.eventId)

  const changed = new Map<string, Map<string, Set<string>>>()
  for (const g of next) {
    const old = prevByGame.get(g.eventId)
    if (!old) continue
    const oldByPlayer = new Map(old.players.map(p => [p.playerName, p]))
    const perPlayer = new Map<string, Set<string>>()
    for (const p of g.players) {
      const op = oldByPlayer.get(p.playerName)
      if (!op) continue
      const allBookIds = new Set<string>([
        ...Object.keys(op.byBook),
        ...Object.keys(p.byBook),
      ])
      const cells = new Set<string>()
      for (const bid of allBookIds) {
        const a = op.byBook[bid]
        const b = p.byBook[bid]
        if ((a?.overPrice ?? null) !== (b?.overPrice ?? null) ||
            (a?.underPrice ?? null) !== (b?.underPrice ?? null) ||
            (a?.line ?? null) !== (b?.line ?? null)) {
          cells.add(bid)
        }
      }
      if (cells.size > 0) perPlayer.set(p.playerName, cells)
    }
    if (perPlayer.size > 0) changed.set(g.eventId, perPlayer)
  }

  return { addedGames, removedGameIds, changed }
}

export function isPropsDiffEmpty(d: PropsDiff): boolean {
  return d.addedGames.length === 0 && d.removedGameIds.length === 0 && d.changed.size === 0
}
