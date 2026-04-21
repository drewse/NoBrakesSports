'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import {
  BOOK_FILTER_COOKIE,
  USA_BOOK_SLUGS,
  CANADA_BOOK_SLUGS_FALLBACK,
} from '@/lib/book-filter'

interface Source {
  name: string
  slug: string
}

interface BooksViewProps {
  sources: Source[]
  initialEnabled: string[] | null  // null = all enabled
  canadianSlugs?: string[]
}

type Region = 'canada' | 'usa'

const REGION_LABEL: Record<Region, string> = { canada: 'CA', usa: 'USA' }
const REGION_CLASSES: Record<Region, string> = {
  canada: 'bg-red-900/50 text-red-300',
  usa: 'bg-blue-900/50 text-blue-300',
}

export function BooksView({ sources, initialEnabled, canadianSlugs }: BooksViewProps) {
  const router = useRouter()

  const canadianSet = canadianSlugs && canadianSlugs.length > 0
    ? new Set(canadianSlugs)
    : CANADA_BOOK_SLUGS_FALLBACK

  // Only show CA or USA books — no intl
  const scopedSources = useMemo(
    () => sources.filter(s => canadianSet.has(s.slug) || USA_BOOK_SLUGS.has(s.slug)),
    [sources, canadianSet],
  )
  const allSlugs = useMemo(() => scopedSources.map(s => s.slug), [scopedSources])

  function getRegions(slug: string): Set<Region> {
    const regions = new Set<Region>()
    if (canadianSet.has(slug)) regions.add('canada')
    if (USA_BOOK_SLUGS.has(slug)) regions.add('usa')
    return regions
  }
  function primaryRegion(slug: string): Region {
    return canadianSet.has(slug) ? 'canada' : 'usa'
  }

  const [enabled, setEnabled] = useState<Set<string>>(
    () => initialEnabled ? new Set(initialEnabled) : new Set(allSlugs),
  )

  const persist = useCallback((next: Set<string>) => {
    setEnabled(new Set(next))
    const isAll = allSlugs.every(s => next.has(s))
    const value = isAll ? 'all' : JSON.stringify([...next])
    document.cookie = `${BOOK_FILTER_COOKIE}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 365};SameSite=Lax`
    router.refresh()
  }, [allSlugs, router])

  function toggle(slug: string) {
    const next = new Set(enabled)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    persist(next)
  }
  function selectAll() { persist(new Set(allSlugs)) }
  function clearAll() { persist(new Set()) }
  function pickRegion(region: Region) {
    const slugs = scopedSources.filter(s => getRegions(s.slug).has(region)).map(s => s.slug)
    persist(new Set(slugs))
  }

  const sorted = useMemo(() => {
    return [...scopedSources].sort((a, b) => {
      const order: Record<Region, number> = { canada: 0, usa: 1 }
      const diff = order[primaryRegion(a.slug)] - order[primaryRegion(b.slug)]
      if (diff !== 0) return diff
      return a.name.localeCompare(b.name)
    })
  }, [scopedSources, canadianSet])

  const isAll = allSlugs.every(s => enabled.has(s))
  const isCanadaPreset = !isAll
    && scopedSources.filter(s => getRegions(s.slug).has('canada')).every(s => enabled.has(s.slug))
    && scopedSources.filter(s => !getRegions(s.slug).has('canada')).every(s => !enabled.has(s.slug))
    && scopedSources.some(s => getRegions(s.slug).has('canada'))
  const isUsaPreset = !isAll
    && scopedSources.filter(s => getRegions(s.slug).has('usa')).every(s => enabled.has(s.slug))
    && scopedSources.filter(s => !getRegions(s.slug).has('usa')).every(s => !enabled.has(s.slug))
    && scopedSources.some(s => getRegions(s.slug).has('usa'))

  return (
    <div className="space-y-4">
      {/* Quick-select actions */}
      <div className="rounded-lg border border-border bg-nb-900 p-3 sm:p-4">
        <p className="text-[10px] font-semibold text-nb-500 uppercase tracking-wider mb-2">
          Quick Select
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={selectAll}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isAll ? 'bg-white text-nb-950' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            All Books
          </button>
          <button
            onClick={() => pickRegion('canada')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isCanadaPreset ? 'bg-red-700 text-white' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            🇨🇦 Canada
          </button>
          <button
            onClick={() => pickRegion('usa')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isUsaPreset ? 'bg-blue-600 text-white' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            🇺🇸 USA
          </button>
          <button
            onClick={clearAll}
            className="rounded px-3 py-1.5 text-xs font-medium bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white transition-colors"
          >
            Clear
          </button>
        </div>
        <p className="mt-3 text-[11px] text-nb-500">
          {enabled.size} of {scopedSources.length} books selected
        </p>
      </div>

      {/* Book grid */}
      <div className="rounded-lg border border-border bg-nb-900 overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
          {sorted.map(source => {
            const regions = getRegions(source.slug)
            const isChecked = enabled.has(source.slug)
            return (
              <button
                key={source.slug}
                onClick={() => toggle(source.slug)}
                className={`flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  isChecked ? 'bg-nb-900 hover:bg-nb-800' : 'bg-nb-950 hover:bg-nb-900'
                }`}
              >
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    isChecked ? 'bg-white border-white' : 'border-nb-600'
                  }`}
                >
                  {isChecked && <Check className="h-3 w-3 text-nb-950" strokeWidth={3} />}
                </div>
                <BookLogo name={source.slug ?? source.name} size="sm" />
                <span className={`text-xs flex-1 ${isChecked ? 'text-white' : 'text-nb-400'}`}>
                  {source.name}
                </span>
                <div className="flex gap-1">
                  {(['canada', 'usa'] as const)
                    .filter(r => regions.has(r))
                    .map(r => (
                      <span
                        key={r}
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${REGION_CLASSES[r]}`}
                      >
                        {REGION_LABEL[r]}
                      </span>
                    ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
