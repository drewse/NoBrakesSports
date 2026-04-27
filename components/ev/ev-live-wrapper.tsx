'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { EvCalculatorClient, type UnifiedEvLine } from '@/app/(app)/top-lines/ev-calculator-client'
import { LiveIndicator } from '@/components/shared/live-indicator'

interface EvResult {
  lines: UnifiedEvLine[]
  leagues: string[]
  totalEvents: number
}

const POLL_MS = 10_000
const LEAVE_MS = 1500
const ENTER_MS = 900
const DIFF_DEBOUNCE_MS = 200

const fetcher = async (url: string): Promise<EvResult> => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return r.json()
}

function diffLines(prev: UnifiedEvLine[], next: UnifiedEvLine[]) {
  const prevById = new Map(prev.map(l => [l.id, l]))
  const nextById = new Map(next.map(l => [l.id, l]))
  const added = next.filter(l => !prevById.has(l.id)).map(l => l.id)
  const removed = prev.filter(l => !nextById.has(l.id))
  return { added: new Set(added), removed: new Set(removed.map(l => l.id)), removedRows: removed }
}

export function EvLiveWrapper({ initial }: { initial: EvResult }) {
  const sp = useSearchParams()
  const apiUrl = useMemo(() => {
    const qs = sp?.toString() ?? ''
    return `/api/ev${qs ? `?${qs}` : ''}`
  }, [sp])

  const [pollEnabled, setPollEnabled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setPollEnabled(true), Math.floor(Math.random() * 2000))
    return () => clearTimeout(t)
  }, [])

  const { data } = useSWR<EvResult>(pollEnabled ? apiUrl : null, fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: false,
    revalidateIfStale: false,
    revalidateOnReconnect: true,
    dedupingInterval: 5000,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: initial,
    keepPreviousData: true,
  })

  const live = data ?? initial
  const [rendered, setRendered] = useState<EvResult>(initial)
  const prevRef = useRef<EvResult>(initial)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  useEffect(() => {
    return () => {
      for (const t of timersRef.current) clearTimeout(t)
      timersRef.current.clear()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (!live) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => apply(live), DIFF_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  function apply(next: EvResult) {
    const prev = prevRef.current
    const d = diffLines(prev.lines, next.lines)

    if (d.added.size === 0 && d.removed.size === 0) {
      prevRef.current = next
      const same = JSON.stringify(prev.lines) === JSON.stringify(next.lines)
      if (!same) setRendered(next)
      return
    }

    const liveAnnotated: UnifiedEvLine[] = next.lines.map(l =>
      d.added.has(l.id) ? { ...l, _anim: 'entering' as const } : l,
    )
    const leavingAnnotated: UnifiedEvLine[] = d.removedRows.map(l => ({ ...l, _anim: 'leaving' as const }))
    setRendered({
      lines: [...liveAnnotated, ...leavingAnnotated],
      leagues: next.leagues,
      totalEvents: next.totalEvents,
    })

    const t1 = setTimeout(() => {
      setRendered(curr => ({
        ...curr,
        lines: curr.lines.map(l => {
          if (l._anim === 'entering') {
            const { _anim, ...rest } = l
            return rest as UnifiedEvLine
          }
          return l
        }),
      }))
    }, ENTER_MS + 50)
    timersRef.current.add(t1)

    if (d.removed.size > 0) {
      const t2 = setTimeout(() => {
        setRendered(curr => ({
          ...curr,
          lines: curr.lines.filter(l => !(l._anim === 'leaving' && d.removed.has(l.id))),
        }))
      }, LEAVE_MS + 50)
      timersRef.current.add(t2)
    }

    prevRef.current = next
  }

  return (
    <>
      <div className="flex justify-end mb-2">
        <LiveIndicator active={pollEnabled} />
      </div>
      <EvCalculatorClient
        lines={rendered.lines}
        totalEvents={rendered.totalEvents}
      />
    </>
  )
}
