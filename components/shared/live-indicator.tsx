'use client'

export function LiveIndicator({ active = true, label = 'Live' }: { active?: boolean; label?: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-nb-400">
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500 live-dot' : 'bg-nb-600'}`}
        aria-hidden
      />
      {label}
    </div>
  )
}
