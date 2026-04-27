'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { OddsTable, type OddsRow, type BookColumn } from './odds-table'
import { PropsTable, type PropsGameRow, type PlayerPropRow } from './props-table'
import { LiveIndicator } from '@/components/shared/live-indicator'
import {
  diffGameRows, isGameDiffEmpty,
  diffPropsRows, isPropsDiffEmpty,
} from '@/lib/odds/diff'
import type { MarketSelection } from '@/lib/odds/market-key'

type GamePayload  = { kind: 'game';  rows: OddsRow[];      books: BookColumn[] }
type PropsPayload = { kind: 'props'; rows: PropsGameRow[]; books: BookColumn[] }
type Payload = GamePayload | PropsPayload | null

const POLL_MS = 10_000
const LEAVE_MS = 1500
const ENTER_MS = 900
const FLICKER_MS = 900
const DIFF_DEBOUNCE_MS = 200

const fetcher = async (url: string) => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  const j = await r.json()
  return j.payload as Payload
}

export function OddsClient({
  selection,
  initialPayload,
}: {
  selection: MarketSelection
  initialPayload: Payload
}) {
  const sp = useSearchParams()
  // Build polling URL — same query params as the page, plus mounted-time
  // jitter (0–2s) so concurrent users don't all hit the API on the same
  // 10s tick. Jitter applied via initial setTimeout in useEffect below.
  const apiUrl = useMemo(() => {
    const qs = sp?.toString() ?? ''
    return `/api/odds${qs ? `?${qs}` : ''}`
  }, [sp])

  // 0–2s startup jitter — gate SWR until the timer fires.
  const [pollEnabled, setPollEnabled] = useState(false)
  useEffect(() => {
    const jitter = Math.floor(Math.random() * 2000)
    const t = setTimeout(() => setPollEnabled(true), jitter)
    return () => clearTimeout(t)
  }, [])

  const { data } = useSWR<Payload>(pollEnabled ? apiUrl : null, fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: initialPayload ?? undefined,
    keepPreviousData: true,
  })

  // Live payload — what the SWR hook currently has.
  const live = data ?? initialPayload

  // ─── Animation state ────────────────────────────────────────────────
  // We never re-render the whole table on a poll. Instead we keep:
  //   - `rendered`: the rows we currently show (includes leaving rows)
  //   - row-level _anim ('entering' | 'leaving') with timed clear
  //   - per-row _flickerCells with timed clear
  //
  // On every payload change we diff against the previous payload, then
  // schedule timeouts to clear the marks.
  const [rendered, setRendered] = useState<Payload>(initialPayload)
  const prevPayloadRef = useRef<Payload>(initialPayload)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => {
    // Tear down outstanding clear-timers on unmount so we don't leak.
    return () => {
      for (const t of clearTimersRef.current) clearTimeout(t)
      clearTimersRef.current.clear()
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!live) return
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      applyDiff(live)
    }, DIFF_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  function applyDiff(next: NonNullable<Payload>) {
    const prev = prevPayloadRef.current
    if (!prev) {
      prevPayloadRef.current = next
      setRendered(next)
      return
    }

    if (next.kind === 'game' && prev.kind === 'game') {
      const d = diffGameRows(prev.rows, next.rows)
      if (isGameDiffEmpty(d)) {
        // Same data shape AND values — only refresh prevPayloadRef so
        // future diffs compare against the latest snapshot. Do NOT
        // setRendered (avoids React reconciliation churn).
        prevPayloadRef.current = next
        return
      }

      // Build a synthetic row list:
      //   - all rows from `next`, with _flickerCells if changed
      //   - removed rows from `prev`, marked _anim='leaving' (kept until LEAVE_MS)
      //   - added rows marked _anim='entering' (until ENTER_MS)
      const removedSet = new Set(d.removedIds)
      const addedSet = new Set(d.added.map(r => r.eventId))
      const liveRows: OddsRow[] = next.rows.map(r => {
        const flickers = d.changed.get(r.eventId)
        const isAdded = addedSet.has(r.eventId)
        const annotated: OddsRow = { ...r }
        if (flickers) annotated._flickerCells = flickers
        if (isAdded) annotated._anim = 'entering'
        return annotated
      })
      const leavingRows: OddsRow[] = prev.rows
        .filter(r => removedSet.has(r.eventId))
        .map(r => ({ ...r, _anim: 'leaving' as const }))

      const merged: OddsRow[] = [...liveRows, ...leavingRows]
      setRendered({ kind: 'game', rows: merged, books: next.books })

      // Schedule clears.
      const t1 = setTimeout(() => {
        // After flicker / enter window, drop the marks (re-render with `next` only).
        setRendered(curr => {
          if (!curr || curr.kind !== 'game') return curr
          const cleaned = curr.rows
            .filter(r => r._anim !== 'leaving' || !removedSet.has(r.eventId)) // keep leaving until LEAVE timer fires
            .map(r => {
              if (r._anim === 'leaving') return r // still in leaving window
              const { _flickerCells, _anim, ...rest } = r
              return rest as OddsRow
            })
          return { ...curr, rows: cleaned }
        })
      }, Math.max(FLICKER_MS, ENTER_MS) + 50)
      clearTimersRef.current.add(t1)

      if (removedSet.size > 0) {
        const t2 = setTimeout(() => {
          setRendered(curr => {
            if (!curr || curr.kind !== 'game') return curr
            const cleaned = curr.rows.filter(r => !(r._anim === 'leaving' && removedSet.has(r.eventId)))
            return { ...curr, rows: cleaned }
          })
        }, LEAVE_MS + 50)
        clearTimersRef.current.add(t2)
      }
    } else if (next.kind === 'props' && prev.kind === 'props') {
      const d = diffPropsRows(prev.rows, next.rows)
      if (isPropsDiffEmpty(d)) {
        prevPayloadRef.current = next
        return
      }

      const removedSet = new Set(d.removedGameIds)
      const addedSet = new Set(d.addedGames.map(g => g.eventId))

      const liveGames: PropsGameRow[] = next.rows.map(g => {
        const flickerByPlayer = d.changed.get(g.eventId)
        const annotated: PropsGameRow = { ...g, players: g.players.map(p => {
          const flickers = flickerByPlayer?.get(p.playerName)
          if (!flickers) return p
          return { ...p, _flickerCells: flickers } satisfies PlayerPropRow
        }) }
        if (addedSet.has(g.eventId)) annotated._anim = 'entering'
        return annotated
      })
      const leavingGames: PropsGameRow[] = prev.rows
        .filter(g => removedSet.has(g.eventId))
        .map(g => ({ ...g, _anim: 'leaving' as const }))
      setRendered({ kind: 'props', rows: [...liveGames, ...leavingGames], books: next.books })

      const t1 = setTimeout(() => {
        setRendered(curr => {
          if (!curr || curr.kind !== 'props') return curr
          const cleaned = curr.rows.map(g => {
            if (g._anim === 'leaving') return g
            const { _anim, ...gameRest } = g
            return {
              ...gameRest,
              players: g.players.map(p => {
                const { _flickerCells, ...rest } = p
                return rest as PlayerPropRow
              }),
            } as PropsGameRow
          })
          return { ...curr, rows: cleaned }
        })
      }, Math.max(FLICKER_MS, ENTER_MS) + 50)
      clearTimersRef.current.add(t1)

      if (removedSet.size > 0) {
        const t2 = setTimeout(() => {
          setRendered(curr => {
            if (!curr || curr.kind !== 'props') return curr
            const cleaned = curr.rows.filter(g => !(g._anim === 'leaving' && removedSet.has(g.eventId)))
            return { ...curr, rows: cleaned }
          })
        }, LEAVE_MS + 50)
        clearTimersRef.current.add(t2)
      }
    } else {
      // Kind changed (e.g. user switched market) — replace wholesale.
      setRendered(next)
    }

    prevPayloadRef.current = next
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex justify-end">
        <LiveIndicator active={pollEnabled} />
      </div>
      {rendered?.kind === 'game' && (
        <OddsTable selection={selection} rows={rendered.rows} books={rendered.books} />
      )}
      {rendered?.kind === 'props' && (
        <PropsTable rows={rendered.rows} books={rendered.books} />
      )}
      {!rendered && (
        <div className="rounded-lg border border-border bg-nb-900/40 px-6 py-16 text-center">
          <p className="text-sm font-semibold text-white">Selection not yet supported</p>
          <p className="text-xs text-nb-400 max-w-md mx-auto mt-2 leading-relaxed">
            Period-specific player props and first-half team totals aren&apos;t
            in the DB schema yet. Full-game variants work — pick a different
            period or switch markets.
          </p>
        </div>
      )}
    </>
  )
}
