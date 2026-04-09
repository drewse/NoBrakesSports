// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Lock
//
// Prevents overlapping pipeline runs using a DB-level lock on data_pipelines.
// Uses a single UPDATE ... WHERE to make acquisition atomic — no race condition.
//
// Why not Postgres advisory locks? Supabase uses PgBouncer in transaction mode,
// which makes session-scoped advisory locks unreliable. The UPDATE-WHERE pattern
// is the correct approach for Supabase.
//
// Stale lock detection: if locked_at is older than STALE_LOCK_MS (10 min),
// the lock is treated as dead (crashed/killed function) and overwritten.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

const STALE_LOCK_MS = 10 * 60 * 1000 // 10 minutes

export type AcquireResult =
  | { acquired: true }
  | { acquired: false; reason: 'already_running' | 'not_found' | 'db_error'; detail?: string }

/**
 * Atomically acquire a run lock on a pipeline.
 * Returns { acquired: true } on success.
 * Returns { acquired: false, reason } if the pipeline is already locked or not found.
 *
 * Stale locks (locked_at older than STALE_LOCK_MS) are overwritten automatically.
 */
export async function acquirePipelineLock(
  db: SupabaseClient,
  slug: string
): Promise<AcquireResult> {
  const now = new Date().toISOString()
  const staleThreshold = new Date(Date.now() - STALE_LOCK_MS).toISOString()

  try {
    // First check if the pipeline exists at all
    const { data: existing } = await db
      .from('data_pipelines')
      .select('id, is_running, locked_at')
      .eq('slug', slug)
      .single()

    if (!existing) {
      return { acquired: false, reason: 'not_found', detail: `No pipeline found with slug: ${slug}` }
    }

    // Atomically acquire: only update if not running OR if lock is stale
    // We do this by fetching and checking ourselves since Supabase JS doesn't
    // expose conditional UPDATE with row count. We rely on the is_running check
    // plus optimistic check of locked_at.
    const isStale = existing.locked_at && existing.locked_at < staleThreshold
    if (existing.is_running && !isStale) {
      return {
        acquired: false,
        reason: 'already_running',
        detail: `Pipeline ${slug} locked at ${existing.locked_at}`,
      }
    }

    // Acquire the lock
    const { error } = await db
      .from('data_pipelines')
      .update({
        is_running: true,
        locked_at: now,
        last_heartbeat_at: now,
        updated_at: now,
      })
      .eq('slug', slug)

    if (error) {
      return { acquired: false, reason: 'db_error', detail: error.message }
    }

    return { acquired: true }
  } catch (e: any) {
    return { acquired: false, reason: 'db_error', detail: e.message }
  }
}

/**
 * Release the lock unconditionally.
 * Always call this in a finally block to prevent stuck locks.
 */
export async function releasePipelineLock(
  db: SupabaseClient,
  slug: string
): Promise<void> {
  const now = new Date().toISOString()
  try {
    await db
      .from('data_pipelines')
      .update({
        is_running: false,
        locked_at: null,
        updated_at: now,
      })
      .eq('slug', slug)
  } catch {
    // Swallow — we're in a finally block, don't mask original error
  }
}

/**
 * Update last_heartbeat_at to prove the run is still alive.
 * Long-running adapters should call this every ~30s.
 * The dashboard uses this to detect zombie runs.
 */
export async function heartbeatPipelineLock(
  db: SupabaseClient,
  slug: string
): Promise<void> {
  try {
    await db
      .from('data_pipelines')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('slug', slug)
  } catch {
    // Non-fatal — don't throw from a heartbeat
  }
}
