'use client'

/**
 * Two-state indicator for SWR-polled pages:
 *   active=false               → grey dot, "Live" (poll not started yet)
 *   active=true, updating=false → green dot, "Live" (idle between polls)
 *   active=true, updating=true  → cyan dot, "Updating odds…" (revalidation in flight)
 *
 * The updating state replaces full-screen skeletons during background
 * refreshes — old data stays visible, the indicator is the only UX
 * signal that a fetch is in flight.
 */
export function LiveIndicator({
  active = true,
  updating = false,
  label = 'Live',
}: {
  active?: boolean
  updating?: boolean
  label?: string
}) {
  const dot = !active
    ? 'bg-nb-600'
    : updating
      ? 'bg-cyan-400 live-dot'
      : 'bg-green-500 live-dot'

  const text = active && updating ? 'Updating odds…' : label
  const textCls = active && updating ? 'text-cyan-300' : 'text-nb-400'

  return (
    <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider ${textCls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </div>
  )
}
