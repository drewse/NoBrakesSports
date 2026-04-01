import type { SupabaseClient } from '@supabase/supabase-js'
import type { RawPayloadType } from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Raw payload helpers
//
// Stores verbatim source responses in raw_source_payloads for:
//  - debugging bad parses
//  - replaying ingestion without re-hitting the source
//  - historical diffing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely serialize any value to a JSON-compatible object.
 * Returns { _error: '...' } if the value cannot be serialized.
 */
function safeSerialize(value: unknown): unknown {
  try {
    // Round-trip through JSON to strip non-serializable values (undefined, functions, etc.)
    return JSON.parse(JSON.stringify(value))
  } catch {
    return { _error: 'payload could not be serialized to JSON', _type: typeof value }
  }
}

export interface StoreRawPayloadOptions {
  db: SupabaseClient
  pipelineSlug: string
  runId: string | null
  payloadType: RawPayloadType
  payload: unknown
}

/**
 * Persist a raw payload to raw_source_payloads.
 * Fails silently — a storage error must never crash the pipeline.
 */
export async function storeRawPayload({
  db,
  pipelineSlug,
  runId,
  payloadType,
  payload,
}: StoreRawPayloadOptions): Promise<{ id: string } | null> {
  try {
    const safe = safeSerialize(payload)
    const { data, error } = await db
      .from('raw_source_payloads')
      .insert({
        pipeline_slug: pipelineSlug,
        run_id: runId,
        payload_type: payloadType,
        payload: safe,
        captured_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) {
      console.warn(`[raw-payloads] Failed to store ${payloadType} for ${pipelineSlug}:`, error.message)
      return null
    }
    return data as { id: string }
  } catch (err) {
    console.warn(`[raw-payloads] Unexpected error for ${pipelineSlug}:`, err)
    return null
  }
}

/** Convenience wrapper for event payloads */
export function storeEventsPayload(
  db: SupabaseClient,
  pipelineSlug: string,
  runId: string | null,
  payload: unknown
) {
  return storeRawPayload({ db, pipelineSlug, runId, payloadType: 'events', payload })
}

/** Convenience wrapper for market payloads */
export function storeMarketsPayload(
  db: SupabaseClient,
  pipelineSlug: string,
  runId: string | null,
  payload: unknown
) {
  return storeRawPayload({ db, pipelineSlug, runId, payloadType: 'markets', payload })
}

/** Convenience wrapper for health payloads */
export function storeHealthPayload(
  db: SupabaseClient,
  pipelineSlug: string,
  runId: string | null,
  payload: unknown
) {
  return storeRawPayload({ db, pipelineSlug, runId, payloadType: 'health', payload })
}
