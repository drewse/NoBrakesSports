// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Ingest — Smart Edition
//
// Redesigned to eliminate the write amplification that caused the Apr-2026
// Supabase CPU spike.
//
// The old design:
//   Every run → INSERT all market snapshots regardless of whether odds changed.
//   Pinnacle (50 events × 3 markets) = 150 inserts/run, every 15 min = 600
//   inserts/hour of mostly-identical rows.  Arbitrage page then scanned 2,000
//   rows to find latest per (event, source, market_type).
//
// The new design:
//   1. DETECT change via odds_hash before writing.
//   2. UPSERT current_market_odds always (1 row per (event, source, type) —
//      fast, tiny table, what the UI actually queries).
//   3. INSERT market_snapshots ONLY when hash changed (true history).
//   4. SKIP raw payload storage if payload fingerprint is unchanged.
//   5. Circuit breaker: skip pipeline after 5 consecutive failures for 1h.
//
// Safety controls (preserved from v1):
//   - DB-level lock: no two concurrent runs for the same pipeline
//   - 280s hard timeout via Promise.race
//   - Event cap (MAX_EVENTS = 200)
//   - Stale lock recovery
//   - Guaranteed lock release in finally block
//
// Lifecycle:
//   fetch → parse → normalize → change-detect → persist deltas → telemetry
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CanonicalEvent, CanonicalMarket } from './types'
import { getAdapter } from './registry'
import { acquirePipelineLock, releasePipelineLock } from './lock'
import { canonicalEventKey } from './normalize'
import {
  computeOddsHash,
  computePayloadHash,
  fetchCurrentHashes,
  partitionByChange,
  upsertCurrentOdds,
  type OddsRow,
} from './change-detection'

const MAX_EVENTS        = 200       // safety cap — prevents runaway ingestion
const TIMEOUT_MS        = 280_000   // 280s — under Vercel's 300s maxDuration
const CIRCUIT_OPEN_MS   = 60 * 60 * 1000  // 1 hour before auto-reset
const CIRCUIT_THRESHOLD = 5                // failures before circuit trips

export type TriggerSource = 'manual' | 'cron' | 'api'

export interface IngestResult {
  slug: string
  eventsFound: number
  eventsUpserted: number
  snapshotsInserted: number   // market_snapshots rows written (changed only)
  snapshotsSkipped: number    // rows confirmed unchanged, not re-written
  isNoOp: boolean             // true when zero snapshots changed
  leagueSlugsFound: string[]
  leagueSlugsMatched: string[]
  errors: string[]
  timedOut?: boolean
  skipped?: boolean
  skipReason?: 'lock_held' | 'circuit_open' | 'not_found'
}

export async function ingestPipeline(
  db: SupabaseClient,
  slug: string,
  options: { triggerSource?: TriggerSource } = {}
): Promise<IngestResult> {
  const triggerSource = options.triggerSource ?? 'manual'
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

  // ── 3. Circuit breaker check ─────────────────────────────────────────────────
  // Fetch pipeline record to inspect circuit state and consecutive failures.
  {
    const { data: pipe } = await db
      .from('data_pipelines')
      .select('circuit_open_at, consecutive_failures')
      .eq('slug', slug)
      .single()

    if (pipe?.circuit_open_at) {
      const openMs = Date.now() - new Date(pipe.circuit_open_at).getTime()
      if (openMs < CIRCUIT_OPEN_MS) {
        const minutesRemaining = Math.ceil((CIRCUIT_OPEN_MS - openMs) / 60_000)
        console.log(`[ingest:${slug}] circuit open — skipping for ${minutesRemaining}m more`)
        return {
          slug, eventsFound: 0, eventsUpserted: 0, snapshotsInserted: 0,
          snapshotsSkipped: 0, isNoOp: true,
          leagueSlugsFound: [], leagueSlugsMatched: [],
          errors: [`Circuit open: ${minutesRemaining}m remaining`],
          skipped: true, skipReason: 'circuit_open',
        }
      }
      // Auto-reset: circuit has been open long enough, try again
      await db.from('data_pipelines')
        .update({ circuit_open_at: null, updated_at: new Date().toISOString() })
        .eq('slug', slug)
      console.log(`[ingest:${slug}] circuit auto-reset — attempting run`)
    }
  }

  // ── 4. Acquire lock — skip if already running ────────────────────────────────
  const lockResult = await acquirePipelineLock(db, slug)
  if (!lockResult.acquired) {
    if (lockResult.reason === 'already_running') {
      console.log(`[ingest:${slug}] skipping — lock held: ${lockResult.detail}`)
      return {
        slug, eventsFound: 0, eventsUpserted: 0, snapshotsInserted: 0,
        snapshotsSkipped: 0, isNoOp: true,
        leagueSlugsFound: [], leagueSlugsMatched: [], errors: [], skipped: true, skipReason: 'lock_held',
      }
    }
    if (lockResult.reason === 'not_found') {
      return {
        slug, eventsFound: 0, eventsUpserted: 0, snapshotsInserted: 0,
        snapshotsSkipped: 0, isNoOp: true,
        leagueSlugsFound: [], leagueSlugsMatched: [],
        errors: [lockResult.detail ?? 'Pipeline not found in DB'],
        skipped: true, skipReason: 'not_found',
      }
    }
    // db_error — log but continue (lock is best-effort for this case)
    console.warn(`[ingest:${slug}] lock acquire warning (${lockResult.reason}): ${lockResult.detail}`)
  }

  // ── 5. Create pipeline_runs record ───────────────────────────────────────────
  const startedAt = new Date().toISOString()
  let runId: string | null = null
  {
    const { data: run } = await db
      .from('pipeline_runs')
      .insert({
        pipeline_slug: slug,
        started_at: startedAt,
        status: 'running',
        trigger_source: triggerSource,
      })
      .select('id')
      .single()
    runId = run?.id ?? null
  }

  // ── 6. Load league lookup ────────────────────────────────────────────────────
  const { data: leagues } = await db.from('leagues').select('id, slug').eq('is_active', true)
  const leagueBySlug: Record<string, string> = Object.fromEntries(
    (leagues ?? []).map((l: any) => [l.slug, l.id])
  )

  // ── 7. Mark pipeline as checked ──────────────────────────────────────────────
  const checkedAt = new Date().toISOString()
  await db.from('data_pipelines').update({
    last_checked_at: checkedAt,
    ...(adapter.ingestionMethod ? { ingestion_method: adapter.ingestionMethod } : {}),
    updated_at: checkedAt,
  }).eq('slug', slug)

  // ── 8. Main ingestion work under 280s hard timeout ───────────────────────────
  let eventsFound        = 0
  let eventsUpserted     = 0
  let snapshotsInserted  = 0
  let snapshotsSkipped   = 0
  let leagueSlugsFound:   string[] = []
  let leagueSlugsMatched: string[] = []
  let timedOut           = false
  let payloadHashChanged = false

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Pipeline ${slug} timed out after ${TIMEOUT_MS / 1000}s`)),
        TIMEOUT_MS
      )
    )

    const mainWork = async () => {
      // ── a. Fetch from adapter ────────────────────────────────────────────────
      const result = await adapter.fetchEvents() as any
      let events: CanonicalEvent[] = result.events ?? []
      const markets: CanonicalMarket[] = result.markets ?? []
      if (result.errors?.length) errors.push(...result.errors)

      // ── b. Event cap ─────────────────────────────────────────────────────────
      if (events.length > MAX_EVENTS) {
        errors.push(`Event cap applied: ${events.length} → ${MAX_EVENTS}`)
        events = events.slice(0, MAX_EVENTS)
      }

      eventsFound        = events.length
      leagueSlugsFound   = [...new Set(events.map(e => e.leagueSlug))].sort()
      leagueSlugsMatched = leagueSlugsFound.filter(s => leagueBySlug[s])
      const leagueSlugsUnmatched = leagueSlugsFound.filter(s => !leagueBySlug[s])

      // ── c. Payload dedup — skip raw storage if nothing changed ───────────────
      const payloadHash = computePayloadHash(events as any, markets.length)
      const { data: pipeRow } = await db
        .from('data_pipelines')
        .select('last_payload_hash')
        .eq('slug', slug)
        .single()

      payloadHashChanged = pipeRow?.last_payload_hash !== payloadHash
      if (payloadHashChanged) {
        // Async — don't await; raw storage is non-critical
        void storePayloadAsync(db, slug, runId, result.raw ?? result, payloadHash)
        void db.from('data_pipelines')
          .update({ last_payload_hash: payloadHash, updated_at: new Date().toISOString() })
          .eq('slug', slug)
      }

      if (events.length === 0) return

      // ── d. Upsert events ─────────────────────────────────────────────────────
      // Use canonicalEventKey as external_id so all sportsbooks describing the
      // same game share ONE row in the events table.
      // e.g. "nba:2026-04-09:toronto raptors:miami heat"
      // This eliminates duplicate events from Pinnacle + BetRivers for the same game.
      const matchedEvents = events.filter(e => leagueBySlug[e.leagueSlug])

      if (matchedEvents.length === 0) {
        const leagueSlugsUnmatched = leagueSlugsFound.filter(s => !leagueBySlug[s])
        if (leagueSlugsUnmatched.length > 0) {
          errors.push(`No matching leagues for slugs: ${leagueSlugsUnmatched.join(', ')}`)
        }
        return
      }

      // Build: source externalId → canonical DB key (for market linkage below)
      const canonicalKeyBySourceId: Record<string, string> = {}
      for (const e of matchedEvents) {
        canonicalKeyBySourceId[e.externalId] = canonicalEventKey(e)
      }

      const eventsToUpsert = matchedEvents.map(e => ({
        external_id: canonicalEventKey(e),
        league_id:   leagueBySlug[e.leagueSlug],
        title:       e.title,
        start_time:  e.startTime,
        status:      e.status === 'live' ? 'live' : 'scheduled',
      }))

      const { data: upsertedEvents, error: eventsError } = await db
        .from('events')
        .upsert(eventsToUpsert, { onConflict: 'external_id', ignoreDuplicates: false })
        .select('id, external_id')

      if (eventsError) throw new Error(`Event upsert failed: ${eventsError.message}`)
      eventsUpserted = upsertedEvents?.length ?? 0

      // canonical key → DB UUID
      const eventIdByCanonicalKey: Record<string, string> = Object.fromEntries(
        (upsertedEvents ?? []).map((e: any) => [e.external_id, e.id])
      )

      // ── e. Build OddsRows ────────────────────────────────────────────────────
      const now = new Date().toISOString()
      const oddsRows: OddsRow[] = []

      for (const market of markets) {
        // Resolve DB event id via: source id → canonical key → DB uuid
        const canonicalKey = canonicalKeyBySourceId[market.eventId]
        const eventId      = canonicalKey ? eventIdByCanonicalKey[canonicalKey] : undefined
        if (!eventId || !sourceId) continue

        const home  = market.outcomes.find(o => o.side === 'home')
        const away  = market.outcomes.find(o => o.side === 'away')
        const draw  = market.outcomes.find(o => o.side === 'draw')
        const over  = market.outcomes.find(o => o.side === 'over')
        const under = market.outcomes.find(o => o.side === 'under')

        oddsRows.push({
          event_id:          eventId,
          source_id:         sourceId,
          market_type:       market.marketType,
          home_price:        home?.price  ?? null,
          away_price:        away?.price  ?? null,
          draw_price:        draw?.price  ?? null,
          spread_value:      market.marketType === 'spread' ? market.lineValue : null,
          total_value:       market.marketType === 'total'  ? market.lineValue : null,
          over_price:        over?.price  ?? null,
          under_price:       under?.price ?? null,
          home_implied_prob: home?.impliedProb  ?? null,
          away_implied_prob: away?.impliedProb  ?? null,
          movement_direction: 'flat',
          snapshot_time:     now,
        })
      }

      if (oddsRows.length === 0) return

      // ── f. Change detection ──────────────────────────────────────────────────
      // One batch query to fetch existing hashes — O(1) round-trips regardless
      // of how many events the adapter returned.
      const eventIds       = [...new Set(oddsRows.map(r => r.event_id))]
      const existingHashes = await fetchCurrentHashes(db, eventIds, sourceId!)
      const { changed, unchanged } = partitionByChange(oddsRows, existingHashes)

      snapshotsSkipped  = unchanged.length
      snapshotsInserted = 0

      console.log(`[ingest:${slug}] changed=${changed.length} unchanged=${unchanged.length}`)

      // ── g. Upsert current_market_odds (ALL rows — proof-of-life) ─────────────
      const { errors: cmoErrors } = await upsertCurrentOdds(db, changed, unchanged, now)
      errors.push(...cmoErrors)

      // ── h. Insert market_snapshots ONLY for changed rows ─────────────────────
      if (changed.length > 0) {
        const BATCH = 500
        for (let i = 0; i < changed.length; i += BATCH) {
          const slice = changed.slice(i, i + BATCH)
          const { error, count } = await db
            .from('market_snapshots')
            .insert(
              slice.map(row => ({
                event_id:           row.event_id,
                source_id:          row.source_id,
                market_type:        row.market_type,
                home_price:         row.home_price,
                away_price:         row.away_price,
                draw_price:         row.draw_price,
                spread_value:       row.spread_value,
                total_value:        row.total_value,
                over_price:         row.over_price,
                under_price:        row.under_price,
                home_implied_prob:  row.home_implied_prob,
                away_implied_prob:  row.away_implied_prob,
                movement_direction: 'flat',
                snapshot_time:      row.snapshot_time,
                odds_hash:          row.odds_hash,
              })),
              { count: 'exact' }
            )
          if (error) {
            errors.push(`market_snapshots insert: ${error.message}`)
          } else {
            snapshotsInserted += count ?? slice.length
          }
        }
      }
    }

    await Promise.race([mainWork(), timeoutPromise])
  } catch (e: any) {
    if (e.message?.includes('timed out')) {
      timedOut = true
      errors.push(e.message)
    } else {
      errors.push(e.message ?? String(e))
    }
  } finally {
    // ── 9. Release lock ──────────────────────────────────────────────────────
    if (lockResult.acquired) {
      await releasePipelineLock(db, slug)
    }

    // ── 10. Update pipeline status + circuit breaker ─────────────────────────
    const finishedAt = new Date().toISOString()
    const hasErrors  = errors.length > 0
    const isNoOp     = !timedOut && snapshotsInserted === 0 && eventsUpserted > 0

    const derivedStatus: string =
      timedOut                                   ? 'error'   :
      eventsUpserted > 0 && !hasErrors           ? 'healthy' :
      eventsUpserted > 0 && hasErrors            ? 'warning' :
      hasErrors                                  ? 'error'   : 'warning'

    // Circuit breaker: on persistent failure, trip the circuit
    const isRunFailure = timedOut || (hasErrors && eventsUpserted === 0)

    const pipelinePatch: Record<string, unknown> = {
      status:        derivedStatus,
      health_status: timedOut ? 'down' : hasErrors ? 'degraded' : 'healthy',
      updated_at:    finishedAt,
    }
    if (eventsUpserted > 0) pipelinePatch.last_success_at = finishedAt
    if (hasErrors) {
      pipelinePatch.last_error_at      = finishedAt
      pipelinePatch.last_error_message = errors[0]
    }

    if (isRunFailure) {
      // Fetch current failure count, then conditionally trip circuit
      const { data: cur } = await db
        .from('data_pipelines')
        .select('consecutive_failures')
        .eq('slug', slug)
        .single()
      const newCount = (cur?.consecutive_failures ?? 0) + 1
      pipelinePatch.consecutive_failures = newCount
      if (newCount >= CIRCUIT_THRESHOLD) {
        pipelinePatch.circuit_open_at = finishedAt
        console.warn(`[ingest:${slug}] circuit tripped after ${newCount} consecutive failures`)
      }
    } else {
      // Success: reset failure counter and clear any circuit state
      pipelinePatch.consecutive_failures = 0
      pipelinePatch.circuit_open_at      = null
    }

    await db.from('data_pipelines').update(pipelinePatch).eq('slug', slug)

    // ── 11. Update pipeline_runs record ─────────────────────────────────────
    if (runId) {
      await db.from('pipeline_runs').update({
        finished_at:        finishedAt,
        status:             timedOut ? 'failed' : isRunFailure ? 'failed' : 'success',
        events_fetched:     eventsFound,
        markets_fetched:    snapshotsInserted + snapshotsSkipped,
        error_count:        errors.length,
        snapshots_inserted: snapshotsInserted,
        snapshots_changed:  snapshotsInserted,
        snapshots_skipped:  snapshotsSkipped,
        is_no_op:           snapshotsInserted === 0 && eventsUpserted > 0,
        timed_out:          timedOut,
        error_messages:     errors.length > 0 ? errors : null,
      }).eq('id', runId)
    }
  }

  const isNoOp = !timedOut && snapshotsInserted === 0 && eventsUpserted > 0

  return {
    slug,
    eventsFound,
    eventsUpserted,
    snapshotsInserted,
    snapshotsSkipped,
    isNoOp,
    leagueSlugsFound,
    leagueSlugsMatched,
    errors,
    timedOut,
  }
}

// ── Async raw payload storage (fire-and-forget) ───────────────────────────────
// Non-critical: failures are logged but never propagate back to the pipeline.

async function storePayloadAsync(
  db: SupabaseClient,
  slug: string,
  runId: string | null,
  payload: unknown,
  hash: string
): Promise<void> {
  try {
    const safe = safeSerialize(payload)
    await db.from('raw_source_payloads').insert({
      pipeline_slug: slug,
      run_id:        runId,
      payload_type:  'events',
      payload:       safe,
      payload_hash:  hash,
      captured_at:   new Date().toISOString(),
    })
  } catch (e: any) {
    console.warn(`[ingest:${slug}] raw payload storage failed:`, e.message)
  }
}

function safeSerialize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return { _error: 'could not serialize payload', _type: typeof value }
  }
}
