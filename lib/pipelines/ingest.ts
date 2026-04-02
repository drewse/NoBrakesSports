// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Ingest
//
// Calls fetchEvents() on an adapter, then writes canonical events and market
// snapshots into the database using the same tables as sync-odds.
//
// Flow:
//   1. Resolve source_id from market_sources (auto-create if missing)
//   2. Call adapter.fetchEvents()
//   3. Store raw payload to raw_source_payloads
//   4. Upsert canonical events → events table (keyed on external_id)
//   5. Insert market snapshots → market_snapshots table
//   6. Return counts
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanonicalEvent, CanonicalMarket } from './types'
import { getAdapter } from './registry'
import { storeEventsPayload } from './raw-payloads'

export interface IngestResult {
  slug: string
  eventsUpserted: number
  snapshotsInserted: number
  errors: string[]
}

export async function ingestPipeline(db: SupabaseClient, slug: string): Promise<IngestResult> {
  const errors: string[] = []

  // ── 1. Get adapter ──────────────────────────────────────────────────────────
  const adapter = getAdapter(slug)
  if (!adapter) throw new Error(`No adapter registered for: ${slug}`)

  // ── 2. Resolve or auto-create market_source ─────────────────────────────────
  let sourceId: string | null = null
  {
    const { data: existing } = await db
      .from('market_sources')
      .select('id')
      .eq('slug', slug)
      .single()

    if (existing) {
      sourceId = existing.id
    } else {
      const { data: created, error } = await db
        .from('market_sources')
        .insert({
          slug,
          name: slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          source_type: 'sportsbook',
          is_active: true,
          health_status: 'healthy',
          display_order: 99,
        })
        .select('id')
        .single()
      if (error || !created) {
        throw new Error(`Failed to create market_source for ${slug}: ${error?.message}`)
      }
      sourceId = created.id
    }
  }

  // ── 3. Load league lookup ────────────────────────────────────────────────────
  const { data: leagues } = await db.from('leagues').select('id, slug').eq('is_active', true)
  const leagueBySlug: Record<string, string> = Object.fromEntries(
    (leagues ?? []).map((l: any) => [l.slug, l.id])
  )

  // ── 4. Fetch events from adapter ─────────────────────────────────────────────
  const result = await adapter.fetchEvents() as any
  const events: CanonicalEvent[] = result.events ?? []
  const markets: CanonicalMarket[] = result.markets ?? []
  if (result.errors?.length) errors.push(...result.errors)

  // Store raw payload for debugging/replay
  await storeEventsPayload(db, slug, null, result.raw ?? result)

  if (events.length === 0) {
    return { slug, eventsUpserted: 0, snapshotsInserted: 0, errors }
  }

  // ── 5. Upsert events ──────────────────────────────────────────────────────────
  // Only upsert events where we have a matching league in the DB
  const eventsToUpsert = events
    .filter(e => leagueBySlug[e.leagueSlug])
    .map(e => ({
      external_id: `${slug}:${e.externalId}`,
      league_id: leagueBySlug[e.leagueSlug],
      title: e.title,
      start_time: e.startTime,
      status: e.status === 'live' ? 'live' : 'scheduled',
    }))

  if (eventsToUpsert.length === 0) {
    // All events had unknown league slugs — log which ones
    const unknown = [...new Set(events.map(e => e.leagueSlug))].filter(s => !leagueBySlug[s])
    errors.push(`No matching leagues for slugs: ${unknown.join(', ')}`)
    return { slug, eventsUpserted: 0, snapshotsInserted: 0, errors }
  }

  const { data: upsertedEvents, error: eventsError } = await db
    .from('events')
    .upsert(eventsToUpsert, { onConflict: 'external_id', ignoreDuplicates: false })
    .select('id, external_id')

  if (eventsError) {
    throw new Error(`Event upsert failed: ${eventsError.message}`)
  }

  const eventIdByExternalId: Record<string, string> = Object.fromEntries(
    (upsertedEvents ?? []).map((e: any) => [e.external_id, e.id])
  )

  // ── 6. Insert market snapshots ────────────────────────────────────────────────
  const snapshots: object[] = []
  const now = new Date().toISOString()

  for (const market of markets) {
    const externalId = `${slug}:${market.eventId}`
    const eventId = eventIdByExternalId[externalId]
    if (!eventId) continue // event's league wasn't in DB

    const home = market.outcomes.find(o => o.side === 'home')
    const away = market.outcomes.find(o => o.side === 'away')
    const draw = market.outcomes.find(o => o.side === 'draw')
    const over = market.outcomes.find(o => o.side === 'over')
    const under = market.outcomes.find(o => o.side === 'under')

    snapshots.push({
      event_id: eventId,
      source_id: sourceId,
      market_type: market.marketType,
      home_price: home?.price ?? null,
      away_price: away?.price ?? null,
      draw_price: draw?.price ?? null,
      spread_value: market.marketType === 'spread' ? market.lineValue : null,
      total_value: market.marketType === 'total' ? market.lineValue : null,
      over_price: over?.price ?? null,
      under_price: under?.price ?? null,
      home_implied_prob: home?.impliedProb ?? null,
      away_implied_prob: away?.impliedProb ?? null,
      movement_direction: 'flat',
      snapshot_time: now,
    })
  }

  let snapshotsInserted = 0
  if (snapshots.length > 0) {
    // Insert in batches of 500 to avoid payload limits
    const BATCH = 500
    for (let i = 0; i < snapshots.length; i += BATCH) {
      const { error, count } = await db
        .from('market_snapshots')
        .insert(snapshots.slice(i, i + BATCH), { count: 'exact' })
      if (error) {
        errors.push(`Snapshot insert batch ${i / BATCH}: ${error.message}`)
      } else {
        snapshotsInserted += count ?? snapshots.slice(i, i + BATCH).length
      }
    }
  }

  return {
    slug,
    eventsUpserted: upsertedEvents?.length ?? 0,
    snapshotsInserted,
    errors,
  }
}
