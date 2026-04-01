import type { SourceAdapter } from './types'
import { createStubAdapter } from './stub-adapter'
import { pointsbetOnAdapter } from './adapters/pointsbet-on'

// ─────────────────────────────────────────────────────────────────────────────
// Central Adapter Registry
//
// Every target sportsbook is registered here. Stubs are used until a real
// adapter is built. To replace a stub, import the real adapter and swap it
// in the ADAPTERS map — no other file needs to change.
//
// All slugs match data_pipelines.slug exactly.
// ─────────────────────────────────────────────────────────────────────────────

// ── All target slugs ──────────────────────────────────────────────────────────

export const ALL_PIPELINE_SLUGS = [
  'fanduel',
  'draftkings',
  'betmgm',
  'caesars',
  'betrivers',
  'bet365',
  'pinnacle',
  'sports_interaction',
  'thescore',
  'pointsbet_on',
  'betway',
  'betvictor',
  'bet99',
  'northstarbets',
  'proline',
  '888sport',
  'bwin',
  'betano',
  'leovegas',
  'tonybet',
  'casumo',
  'ballybet',
  'partypoker',
  'jackpotbet',
] as const

export type PipelineSlug = typeof ALL_PIPELINE_SLUGS[number]

// ── Registry map ──────────────────────────────────────────────────────────────
// Using a Map gives O(1) lookup and makes it easy to iterate all adapters.

const ADAPTERS = new Map<string, SourceAdapter>()

// Register all books as stubs first, then override with real adapters below.
for (const slug of ALL_PIPELINE_SLUGS) {
  ADAPTERS.set(slug, createStubAdapter(slug))
}

// ── Real adapters (replace stubs as each is built) ───────────────────────────
ADAPTERS.set('pointsbet_on', pointsbetOnAdapter)

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve a registered adapter by slug.
 * Returns undefined if the slug is not registered.
 */
export function getAdapter(slug: string): SourceAdapter | undefined {
  return ADAPTERS.get(slug)
}

/**
 * Returns all registered adapters as a read-only array.
 */
export function getAllAdapters(): SourceAdapter[] {
  return Array.from(ADAPTERS.values())
}

/**
 * Returns true if an adapter is registered for the given slug.
 */
export function isRegistered(slug: string): boolean {
  return ADAPTERS.has(slug)
}

/**
 * Register or replace an adapter. Used by real adapter implementations
 * and in tests to inject mock adapters.
 */
export function registerAdapter(adapter: SourceAdapter): void {
  ADAPTERS.set(adapter.slug, adapter)
}

/**
 * Remove an adapter from the registry (test teardown only).
 */
export function unregisterAdapter(slug: string): void {
  ADAPTERS.delete(slug)
}
