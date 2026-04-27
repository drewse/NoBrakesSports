'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { ArbCalculatorClient, type UnifiedArb } from '@/app/(app)/arbitrage/arb-calculator-client'
import { LiveIndicator } from '@/components/shared/live-indicator'

interface ArbsResult {
  arbs: UnifiedArb[]
  totalArbs: number
  uniqueBooks: number
}

const POLL_MS = 10_000
const LEAVE_MS = 1500
const ENTER_MS = 900
const DIFF_DEBOUNCE_MS = 200

const fetcher = async (url: string): Promise<ArbsResult> => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`fetch failed: ${r.status}`)
  return r.json()
}

function diffArbs(prev: UnifiedArb[], next: UnifiedArb[]) {
  const prevById = new Map(prev.map(a => [a.id, a]))
  const nextById = new Map(next.map(a => [a.id, a]))
  const added = next.filter(a => !prevById.has(a.id)).map(a => a.id)
  const removed = prev.filter(a => !nextById.has(a.id)).map(a => a.id)
  return { added: new Set(added), removed: new Set(removed), removedRows: prev.filter(a => !nextById.has(a.id)) }
}

export function ArbLiveWrapper({ initial }: { initial: ArbsResult }) {
  // 0–2s mount jitter so concurrent users don't synchronize on the tick.
  const [pollEnabled, setPollEnabled] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setPollEnabled(true), Math.floor(Math.random() * 2000))
    return () => clearTimeout(t)
  }, [])

  const { data } = useSWR<ArbsResult>(pollEnabled ? '/api/arbitrage' : null, fetcher, {
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
  const [rendered, setRendered] = useState<ArbsResult>(initial)
  const prevRef = useRef<ArbsResult>(initial)
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

  function apply(next: ArbsResult) {
    const prev = prevRef.current
    const d = diffArbs(prev.arbs, next.arbs)

    if (d.added.size === 0 && d.removed.size === 0) {
      // No identity changes — but prices may have moved. Just refresh
      // the underlying data without animation.
      prevRef.current = next
      // Only set if data reference truly differs; SWR may return same object.
      const same = JSON.stringify(prev.arbs) === JSON.stringify(next.arbs) &&
                   prev.totalArbs === next.totalArbs && prev.uniqueBooks === next.uniqueBooks
      if (!same) setRendered(next)
      return
    }

    const liveAnnotated: UnifiedArb[] = next.arbs.map(a =>
      d.added.has(a.id) ? { ...a, _anim: 'entering' as const } : a,
    )
    const leavingAnnotated: UnifiedArb[] = d.removedRows.map(a => ({ ...a, _anim: 'leaving' as const }))
    setRendered({
      arbs: [...liveAnnotated, ...leavingAnnotated],
      totalArbs: next.totalArbs,
      uniqueBooks: next.uniqueBooks,
    })

    const t1 = setTimeout(() => {
      setRendered(curr => ({
        ...curr,
        arbs: curr.arbs.map(a => {
          if (a._anim === 'entering') {
            const { _anim, ...rest } = a
            return rest as UnifiedArb
          }
          return a
        }),
      }))
    }, ENTER_MS + 50)
    timersRef.current.add(t1)

    if (d.removed.size > 0) {
      const t2 = setTimeout(() => {
        setRendered(curr => ({
          ...curr,
          arbs: curr.arbs.filter(a => !(a._anim === 'leaving' && d.removed.has(a.id))),
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
      <ArbCalculatorClient
        arbs={rendered.arbs}
        totalArbs={rendered.totalArbs}
        uniqueBooks={rendered.uniqueBooks}
      />
    </>
  )
}
