'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, ChevronDown, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  BOOK_FILTER_COOKIE,
  USA_BOOK_SLUGS,
  CANADA_BOOK_SLUGS,
} from '@/lib/book-filter'

interface Source {
  name: string
  slug: string
}

interface BookSelectorProps {
  sources: Source[]
  initialEnabled: string[] | null  // null = all enabled
}

function getRegion(slug: string): 'usa' | 'canada' | 'intl' {
  if (USA_BOOK_SLUGS.has(slug)) return 'usa'
  if (CANADA_BOOK_SLUGS.has(slug)) return 'canada'
  return 'intl'
}

const REGION_LABEL: Record<string, string> = {
  usa: 'USA',
  canada: 'CA',
  intl: 'INTL',
}

const REGION_CLASSES: Record<string, string> = {
  usa: 'bg-blue-900/50 text-blue-300',
  canada: 'bg-red-900/50 text-red-300',
  intl: 'bg-nb-800 text-nb-400',
}

export function BookSelector({ sources, initialEnabled }: BookSelectorProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const allSlugs = sources.map(s => s.slug)

  const [enabled, setEnabled] = useState<Set<string>>(
    () => initialEnabled ? new Set(initialEnabled) : new Set(allSlugs)
  )

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const persist = useCallback((next: Set<string>) => {
    setEnabled(next)
    const isAll = allSlugs.every(s => next.has(s))
    const value = isAll ? 'all' : JSON.stringify([...next])
    document.cookie = `${BOOK_FILTER_COOKIE}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`
    router.refresh()
  }, [allSlugs, router])

  function selectPreset(preset: 'all' | 'usa' | 'canada') {
    let next: Set<string>
    if (preset === 'all') {
      next = new Set(allSlugs)
    } else if (preset === 'usa') {
      const usaSlugs = sources.filter(s => getRegion(s.slug) === 'usa').map(s => s.slug)
      next = new Set(usaSlugs.length > 0 ? usaSlugs : allSlugs)
    } else {
      const caSlugs = sources.filter(s => getRegion(s.slug) === 'canada').map(s => s.slug)
      next = new Set(caSlugs.length > 0 ? caSlugs : allSlugs)
    }
    persist(next)
  }

  function toggle(slug: string) {
    const next = new Set(enabled)
    if (next.has(slug)) {
      next.delete(slug)
    } else {
      next.add(slug)
    }
    // Don't allow deselecting all
    if (next.size === 0) return
    persist(next)
  }

  const isAll = allSlugs.every(s => enabled.has(s))
  const isUsaPreset =
    sources.filter(s => getRegion(s.slug) === 'usa').every(s => enabled.has(s.slug)) &&
    sources.filter(s => getRegion(s.slug) !== 'usa').every(s => !enabled.has(s.slug))
  const isCanadaPreset =
    sources.filter(s => getRegion(s.slug) === 'canada').every(s => enabled.has(s.slug)) &&
    sources.filter(s => getRegion(s.slug) !== 'canada').every(s => !enabled.has(s.slug))

  const label = isAll ? 'All Books' : `${enabled.size} of ${sources.length} Books`

  // Sort sources: USA first, then Canada, then Intl, alphabetically within each
  const sorted = [...sources].sort((a, b) => {
    const rOrder = { usa: 0, canada: 1, intl: 2 }
    const ra = rOrder[getRegion(a.slug)]
    const rb = rOrder[getRegion(b.slug)]
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(o => !o)}
        className={`gap-1.5 h-8 px-2.5 text-xs ${isAll ? 'text-nb-400 hover:text-white' : 'text-white bg-nb-800 hover:bg-nb-700'}`}
      >
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span>{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-72 rounded-lg border border-border bg-nb-900 shadow-2xl">
          {/* Preset buttons */}
          <div className="p-3 border-b border-border">
            <p className="text-[10px] font-semibold text-nb-500 uppercase tracking-wider mb-2">Quick Select</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => selectPreset('all')}
                className={`flex-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isAll
                    ? 'bg-white text-nb-950'
                    : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
                }`}
              >
                All Books
              </button>
              <button
                onClick={() => selectPreset('usa')}
                className={`flex-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isUsaPreset && !isAll
                    ? 'bg-blue-600 text-white'
                    : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
                }`}
              >
                🇺🇸 USA Only
              </button>
              <button
                onClick={() => selectPreset('canada')}
                className={`flex-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isCanadaPreset && !isAll
                    ? 'bg-red-700 text-white'
                    : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
                }`}
              >
                🇨🇦 Canada
              </button>
            </div>
          </div>

          {/* Book list */}
          <div className="max-h-72 overflow-y-auto p-2">
            {sorted.map(source => {
              const region = getRegion(source.slug)
              const isChecked = enabled.has(source.slug)
              return (
                <button
                  key={source.slug}
                  onClick={() => toggle(source.slug)}
                  className="flex items-center gap-2.5 w-full rounded px-2 py-1.5 hover:bg-nb-800 transition-colors group"
                >
                  <div
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                      isChecked
                        ? 'bg-white border-white'
                        : 'border-nb-600 group-hover:border-nb-400'
                    }`}
                  >
                    {isChecked && <Check className="h-2.5 w-2.5 text-nb-950" strokeWidth={3} />}
                  </div>
                  <span className={`text-xs flex-1 text-left ${isChecked ? 'text-white' : 'text-nb-400'}`}>
                    {source.name}
                  </span>
                  <span className={`text-[9px] font-semibold px-1 py-0.5 rounded ${REGION_CLASSES[region]}`}>
                    {REGION_LABEL[region]}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="p-2 border-t border-border">
            <p className="text-center text-[10px] text-nb-500">
              {enabled.size} book{enabled.size !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
