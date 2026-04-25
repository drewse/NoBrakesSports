// Pure helpers for the /odds time-range filter. Lives outside the
// 'use client' component so the server-rendered page can call
// timeRangeFromParam() / hoursForRange() — Next.js 16 forbids server
// code from invoking exports of a client module, even non-React ones.

export const TIME_RANGES = [
  { id: '12h', label: '12H', hours: 12   },
  { id: '24h', label: '24H', hours: 24   },
  { id: '3d',  label: '3D',  hours: 72   },
  { id: '7d',  label: '7D',  hours: 168  },
  { id: 'all', label: 'All', hours: null },
] as const

export type TimeRangeId = typeof TIME_RANGES[number]['id']

export function timeRangeFromParam(raw: string | undefined): TimeRangeId {
  const found = TIME_RANGES.find(r => r.id === raw)
  return found?.id ?? 'all'
}

export function hoursForRange(id: TimeRangeId): number | null {
  return TIME_RANGES.find(r => r.id === id)?.hours ?? null
}
