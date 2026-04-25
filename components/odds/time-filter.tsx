'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Clock } from 'lucide-react'
import { TIME_RANGES, type TimeRangeId } from '@/lib/odds/time-range'

export function TimeFilter({ value }: { value: TimeRangeId }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function select(id: TimeRangeId) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (id === 'all') params.delete('within')
    else params.set('within', id)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-nb-900/60 border border-border rounded-full">
      <Clock className="h-3.5 w-3.5 text-nb-500 ml-1.5 mr-0.5" />
      {TIME_RANGES.map(r => {
        const active = r.id === value
        return (
          <button
            key={r.id}
            onClick={() => select(r.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
              active
                ? 'bg-white text-black'
                : 'text-nb-400 hover:text-white hover:bg-nb-800'
            }`}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}
