'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { BookLogo } from '@/components/shared/book-logo'
import {
  BOOK_FILTER_COOKIE,
  USA_BOOK_SLUGS,
  CANADA_BOOK_SLUGS_FALLBACK,
  PREDICTION_MARKET_SLUGS,
  OFFSHORE_BOOK_SLUGS,
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

type Section = 'sportsbooks' | 'prediction' | 'offshore'
type Region = 'canada' | 'usa'

// Display names for prediction-market and offshore slugs that may not be
// present in the `market_sources` DB table yet. We inject these into the
// view so the Prediction Markets and Offshore Books sections render even
// before their pipelines are wired up / marked healthy in the DB.
const PREDICTION_MARKET_DISPLAY: Record<string, string> = {
  'kalshi':                'Kalshi',
  'polymarket':            'Polymarket',
  'polymarket-us':         'Polymarket (US)',
  'robinhood-prediction':  'Robinhood Predict',
  'sporttrade':            'Sporttrade',
  'novig':                 'Novig',
  'prophet-exchange':      'Prophet Exchange',
}

const OFFSHORE_DISPLAY: Record<string, string> = {
  'bovada':                'Bovada',
  'betus':                 'BetUS',
  'betanysports':          'BetAnySports',
  'lowvig':                'LowVig',
  'mybookie':              'MyBookie',
  'betonline':             'BetOnline',
}

const REGION_LABEL: Record<Region, string> = { canada: 'CA', usa: 'USA' }
const REGION_CLASSES: Record<Region, string> = {
  canada: 'bg-red-900/50 text-red-300',
  usa:    'bg-blue-900/50 text-blue-300',
}

const SECTION_META: Record<Section, {
  title: string
  subtitle: string
  accent: string
}> = {
  sportsbooks: { title: 'Sportsbooks',        subtitle: 'Licensed operators — Canada & USA',        accent: 'bg-white text-nb-950' },
  prediction:  { title: 'Prediction Markets', subtitle: 'Event-contract & peer-to-peer exchanges',  accent: 'bg-violet-600 text-white' },
  offshore:    { title: 'Offshore Books',     subtitle: 'Curaçao / Panama-licensed, US-facing',     accent: 'bg-amber-600 text-white' },
}

const SECTION_ORDER: Section[] = ['sportsbooks', 'prediction', 'offshore']

export function BooksView({ sources, initialEnabled, canadianSlugs }: BooksViewProps) {
  const router = useRouter()

  const canadianSet = canadianSlugs && canadianSlugs.length > 0
    ? new Set(canadianSlugs)
    : CANADA_BOOK_SLUGS_FALLBACK

  function sectionOf(slug: string): Section | null {
    if (OFFSHORE_BOOK_SLUGS.has(slug)) return 'offshore'
    if (PREDICTION_MARKET_SLUGS.has(slug)) return 'prediction'
    if (canadianSet.has(slug) || USA_BOOK_SLUGS.has(slug)) return 'sportsbooks'
    return null
  }

  function regionsOf(slug: string): Set<Region> {
    const out = new Set<Region>()
    if (canadianSet.has(slug)) out.add('canada')
    if (USA_BOOK_SLUGS.has(slug)) out.add('usa')
    return out
  }

  // Merge DB sources with static fallback entries for prediction/offshore
  // slugs that aren't in market_sources yet, so those sections always render.
  const mergedSources = useMemo(() => {
    const byslug = new Map<string, Source>()
    for (const s of sources) byslug.set(s.slug, s)
    for (const [slug, name] of Object.entries(PREDICTION_MARKET_DISPLAY)) {
      if (!byslug.has(slug)) byslug.set(slug, { slug, name })
    }
    for (const [slug, name] of Object.entries(OFFSHORE_DISPLAY)) {
      if (!byslug.has(slug)) byslug.set(slug, { slug, name })
    }
    return [...byslug.values()]
  }, [sources])

  const scopedSources = useMemo(
    () => mergedSources.filter(s => sectionOf(s.slug) !== null),
    [mergedSources, canadianSet],
  )
  const allSlugs = useMemo(() => scopedSources.map(s => s.slug), [scopedSources])

  const grouped = useMemo(() => {
    const out: Record<Section, Source[]> = {
      sportsbooks: [], prediction: [], offshore: [],
    }
    for (const s of scopedSources) {
      const sec = sectionOf(s.slug)
      if (sec) out[sec].push(s)
    }
    for (const sec of SECTION_ORDER) {
      out[sec].sort((a, b) => a.name.localeCompare(b.name))
    }
    return out
  }, [scopedSources, canadianSet])

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
  function pickSection(section: Section) {
    persist(new Set(grouped[section].map(s => s.slug)))
  }

  // Region sub-presets inside the Sportsbooks section.
  function pickRegion(region: Region) {
    const slugs = grouped.sportsbooks
      .filter(s => regionsOf(s.slug).has(region))
      .map(s => s.slug)
    persist(new Set(slugs))
  }

  const isAll = allSlugs.every(s => enabled.has(s))
  function isSectionPreset(section: Section): boolean {
    if (isAll) return false
    const inside = grouped[section]
    if (inside.length === 0) return false
    if (!inside.every(s => enabled.has(s.slug))) return false
    return scopedSources.every(s =>
      sectionOf(s.slug) === section ? enabled.has(s.slug) : !enabled.has(s.slug),
    )
  }
  function isRegionPreset(region: Region): boolean {
    if (isAll) return false
    const insideRegion = grouped.sportsbooks.filter(s => regionsOf(s.slug).has(region))
    if (insideRegion.length === 0) return false
    if (!insideRegion.every(s => enabled.has(s.slug))) return false
    return scopedSources.every(s =>
      regionsOf(s.slug).has(region) ? enabled.has(s.slug) : !enabled.has(s.slug),
    )
  }

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
              isRegionPreset('canada') ? 'bg-red-700 text-white' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            🇨🇦 Canada
          </button>
          <button
            onClick={() => pickRegion('usa')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isRegionPreset('usa') ? 'bg-blue-600 text-white' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            🇺🇸 USA
          </button>
          <button
            onClick={() => pickSection('prediction')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isSectionPreset('prediction') ? 'bg-violet-600 text-white' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            Prediction Markets
          </button>
          <button
            onClick={() => pickSection('offshore')}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              isSectionPreset('offshore') ? 'bg-amber-600 text-white' : 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
            }`}
          >
            Offshore
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

      {/* Sections */}
      {SECTION_ORDER.map(section => {
        const meta = SECTION_META[section]
        const rows = grouped[section]
        if (rows.length === 0) return null
        const showRegionPill = section === 'sportsbooks'
        return (
          <div key={section} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div>
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                  {meta.title}
                </h2>
                <p className="text-[10px] text-nb-500 mt-0.5">{meta.subtitle}</p>
              </div>
              <span className="text-[10px] text-nb-500 font-mono">
                {rows.filter(s => enabled.has(s.slug)).length}/{rows.length}
              </span>
            </div>
            <div className="rounded-lg border border-border bg-nb-900 overflow-hidden">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-border">
                {rows.map(source => {
                  const isChecked = enabled.has(source.slug)
                  const regions = showRegionPill ? regionsOf(source.slug) : new Set<Region>()
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
                      {showRegionPill && (
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
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
