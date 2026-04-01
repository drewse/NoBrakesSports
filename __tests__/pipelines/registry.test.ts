import { describe, it, expect, afterEach } from 'vitest'
import {
  ALL_PIPELINE_SLUGS,
  getAdapter,
  getAllAdapters,
  isRegistered,
  registerAdapter,
  unregisterAdapter,
} from '@/lib/pipelines/registry'
import { createStubAdapter } from '@/lib/pipelines/stub-adapter'

describe('Pipeline Registry', () => {
  describe('ALL_PIPELINE_SLUGS', () => {
    it('contains exactly 24 target books', () => {
      expect(ALL_PIPELINE_SLUGS).toHaveLength(24)
    })

    it('includes all required sportsbooks', () => {
      const slugs = new Set(ALL_PIPELINE_SLUGS)
      const required = [
        'fanduel', 'draftkings', 'betmgm', 'caesars', 'betrivers',
        'bet365', 'pinnacle', 'sports_interaction', 'thescore',
        'pointsbet_on', 'betway', 'betvictor', 'bet99', 'northstarbets',
        'proline', '888sport', 'bwin', 'betano', 'leovegas', 'tonybet',
        'casumo', 'ballybet', 'partypoker', 'jackpotbet',
      ]
      for (const slug of required) {
        expect(slugs, `missing required slug: ${slug}`).toContain(slug)
      }
    })

    it('does NOT include excluded books', () => {
      const slugs = new Set(ALL_PIPELINE_SLUGS)
      expect(slugs).not.toContain('rivalry')
      expect(slugs).not.toContain('betsafe')
    })

    it('has no duplicate slugs', () => {
      const unique = new Set(ALL_PIPELINE_SLUGS)
      expect(unique.size).toBe(ALL_PIPELINE_SLUGS.length)
    })
  })

  describe('getAdapter', () => {
    it('returns an adapter for every registered slug', () => {
      for (const slug of ALL_PIPELINE_SLUGS) {
        const adapter = getAdapter(slug)
        expect(adapter, `no adapter for ${slug}`).toBeDefined()
        expect(adapter?.slug).toBe(slug)
      }
    })

    it('returns undefined for unregistered slug', () => {
      expect(getAdapter('nonexistent_book_xyz')).toBeUndefined()
    })
  })

  describe('getAllAdapters', () => {
    it('returns an array with one adapter per registered slug', () => {
      const adapters = getAllAdapters()
      expect(adapters.length).toBeGreaterThanOrEqual(ALL_PIPELINE_SLUGS.length)
    })

    it('every returned adapter has a slug and required methods', () => {
      for (const adapter of getAllAdapters()) {
        expect(typeof adapter.slug).toBe('string')
        expect(typeof adapter.fetchEvents).toBe('function')
        expect(typeof adapter.fetchMarkets).toBe('function')
        expect(typeof adapter.healthCheck).toBe('function')
      }
    })
  })

  describe('isRegistered', () => {
    it('returns true for all registered slugs', () => {
      for (const slug of ALL_PIPELINE_SLUGS) {
        expect(isRegistered(slug)).toBe(true)
      }
    })

    it('returns false for unknown slug', () => {
      expect(isRegistered('not_a_real_book')).toBe(false)
    })
  })

  describe('registerAdapter / unregisterAdapter', () => {
    const testSlug = '__test_book__'

    afterEach(() => {
      unregisterAdapter(testSlug)
    })

    it('registers a new adapter and makes it retrievable', () => {
      const adapter = createStubAdapter(testSlug)
      registerAdapter(adapter)
      expect(isRegistered(testSlug)).toBe(true)
      expect(getAdapter(testSlug)?.slug).toBe(testSlug)
    })

    it('replaces an existing adapter', () => {
      const a1 = createStubAdapter(testSlug)
      const a2 = { ...createStubAdapter(testSlug), slug: testSlug }
      registerAdapter(a1)
      registerAdapter(a2)
      expect(getAdapter(testSlug)).toBe(a2)
    })

    it('unregisterAdapter removes the adapter', () => {
      registerAdapter(createStubAdapter(testSlug))
      unregisterAdapter(testSlug)
      expect(isRegistered(testSlug)).toBe(false)
    })
  })
})
