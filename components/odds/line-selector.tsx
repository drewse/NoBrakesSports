'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Inline line-selector dropdown — patterned after AVO's "Auto" pill on
 * the odds screen. Used by:
 *   - Player props (totals over/under per player)
 *   - Game totals  (when alt-line ingest lands)
 *   - Spreads      (when alt-line ingest lands)
 *
 * The component is purely presentational: parent owns the selectedLine
 * state, this component just renders the pill + dropdown and emits
 * onChange. `null` means "Auto" (parent should resolve to consensus).
 */

export interface LineOption {
  /** The numeric line — e.g. 21.5 for total points 21.5. */
  value: number
  /** How many books are quoting this line. Drives a small chip beside
   *  the value so users can spot thin-coverage lines at a glance. */
  bookCount: number
  /** Optional label override (e.g. "Auto · 21.5"). Defaults to formatLine(value). */
  label?: string
}

interface Props {
  /** All lines we have data for, sorted ascending. */
  lines: LineOption[]
  /** Currently-selected numeric line, or null for "Auto" (consensus). */
  selected: number | null
  /** The line "Auto" resolves to — shown in the Auto row + as the
   *  default selection text when selected === null. */
  autoLine: number | null
  onChange: (line: number | null) => void
  /** Tight mode for use inside dense table cells. */
  compact?: boolean
}

function formatLine(n: number): string {
  // Strip trailing .0 but keep .5
  return Number.isInteger(n) ? String(n) : n.toString()
}

export function LineSelector({ lines, selected, autoLine, onChange, compact = false }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Click-away to close.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // ESC key to close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const buttonLabel = selected == null
    ? (autoLine != null ? `Auto · ${formatLine(autoLine)}` : 'Auto')
    : formatLine(selected)

  // The dropdown shows Auto first, then every line ascending.
  const items: Array<{ key: string; label: string; value: number | null; bookCount: number; isAuto?: boolean }> = []
  if (autoLine != null) {
    const autoOpt = lines.find(l => l.value === autoLine)
    items.push({
      key: 'auto',
      label: `Auto · ${formatLine(autoLine)}`,
      value: null,
      bookCount: autoOpt?.bookCount ?? 0,
      isAuto: true,
    })
  } else {
    items.push({ key: 'auto', label: 'Auto', value: null, bookCount: 0, isAuto: true })
  }
  for (const l of lines) {
    items.push({ key: String(l.value), label: l.label ?? formatLine(l.value), value: l.value, bookCount: l.bookCount })
  }

  const sizeCls = compact
    ? 'h-6 px-2 text-[11px]'
    : 'h-7 px-2.5 text-xs'

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={`inline-flex items-center gap-1 ${sizeCls} rounded-md border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-nb-200 font-mono font-medium transition-colors`}
      >
        <span className="whitespace-nowrap">{buttonLabel}</span>
        <ChevronDown className={`h-3 w-3 text-nb-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 top-full mt-1 z-30 min-w-[120px] max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-nb-950/95 backdrop-blur-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)]"
        >
          <ul className="py-1">
            {items.length === 1 && (
              <li className="px-3 py-2 text-[11px] text-nb-500 italic">
                No alternate lines yet
              </li>
            )}
            {items.map(item => {
              const isSelected =
                (item.value === null && selected === null) ||
                (item.value !== null && selected === item.value)
              const isThin = !item.isAuto && item.bookCount > 0 && item.bookCount < 3
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onChange(item.value); setOpen(false) }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-white/10 text-white font-semibold'
                        : 'text-nb-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span className="font-mono">{item.label}</span>
                    {!item.isAuto && (
                      <span className={`text-[9px] ${isThin ? 'text-amber-400' : 'text-nb-500'}`}>
                        {item.bookCount} {item.bookCount === 1 ? 'book' : 'books'}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
