'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, ChevronDown, Check } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import { Button } from '@/components/ui/button'
import {
  BOOK_FILTER_COOKIE,
  USA_BOOK_SLUGS,
  CANADA_BOOK_SLUGS_FALLBACK,
} from '@/lib/book-filter'

interface Source {
  name: string
  slug: string
}

interface BookSelectorProps {
  sources: Source[]
  initialEnabled: string[] | null  // null = all enabled
  canadianSlugs?: string[]         // from data_pipelines table — authoritative CA list
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

export function BookSelector({ sources, initialEnabled, canadianSlugs }: BookSelectorProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Canadian books = pipeline slugs from DB, with static fallback
  const canadianSet = canadianSlugs && canadianSlugs.length > 0
    ? new Set(canadianSlugs)
    : CANADA_BOOK_SLUGS_FALLBACK

  // Region detection — a book can belong to multiple regions (overlap allowed)
  function getRegions(slug: string): Set<'usa' | 'canada' | 'intl'> {
    const regions = new Set<'usa' | 'canada' | 'intl'>()
    if (USA_BOOK_SLUGS.has(slug)) regions.add('usa')
    if (canadianSet.has(slug)) regions.add('canada')
    if (regions.size === 0) regions.add('intl')
    return regions
  }

  // Primary region for sorting/badge display
  function getPrimaryRegion(slug: string): 'usa' | 'canada' | 'intl' {
    if (canadianSet.has(slug)) return 'canada'
    if (USA_BOOK_SLUGS.has(slug)) return 'usa'
    return 'intl'
  }

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
      const usaSlugs = sources.filter(s => getRegions(s.slug).has('usa')).map(s => s.slug)
      next = new Set(usaSlugs.length > 0 ? usaSlugs : allSlugs)
    } else {
      const caSlugs = sources.filter(s => getRegions(s.slug).has('canada')).map(s => s.slug)
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

  const usaSources = sources.filter(s => getRegions(s.slug).has('usa'))
  const caSources = sources.filter(s => getRegions(s.slug).has('canada'))

  const isUsaPreset = !isAll &&
    usaSources.length > 0 &&
    usaSources.every(s => enabled.has(s.slug)) &&
    sources.filter(s => !getRegions(s.slug).has('usa')).every(s => !enabled.has(s.slug))
  const isCanadaPreset = !isAll &&
    caSources.length > 0 &&
    caSources.every(s => enabled.has(s.slug)) &&
    sources.filter(s => !getRegions(s.slug).has('canada')).every(s => !enabled.has(s.slug))

  const label = isAll ? 'All Books' : `${enabled.size} of ${sources.length} Books`

  // Sort sources: Canada first (our primary market), then USA, then Intl
  const sorted = [...sources].sort((a, b) => {
    const rOrder = { canada: 0, usa: 1, intl: 2 }
    const ra = rOrder[getPrimaryRegion(a.slug)]
    const rb = rOrder[getPrimaryRegion(b.slug)]
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
                  isUsaPreset
                    ? 'bg-blue-600 text-white'
                    : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
                }`}
              >
                🇺🇸 USA
              </button>
              <button
                onClick={() => selectPreset('canada')}
                className={`flex-1 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isCanadaPreset
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
              const regions = getRegions(source.slug)
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
                  <BookLogo name={source.slug ?? source.name} size="sm" />
                  <span className={`text-xs flex-1 text-left ${isChecked ? 'text-white' : 'text-nb-400'}`}>
                    {source.name}
                  </span>
                  <div className="flex gap-0.5">
                    {(['canada', 'usa', 'intl'] as const)
                      .filter(r => regions.has(r))
                      .map(r => (
                        <span key={r} className={`text-[9px] font-semibold px-1 py-0.5 rounded ${REGION_CLASSES[r]}`}>
                          {REGION_LABEL[r]}
                        </span>
                      ))}
                  </div>
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
