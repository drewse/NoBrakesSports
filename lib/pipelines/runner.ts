import type { SupabaseClient } from '@supabase/supabase-js'
import type { PipelineRunStatus, PipelineErrorType } from './types'
import { getAdapter } from './registry'
import { NotImplementedError } from './stub-adapter'
import { storeHealthPayload } from './raw-payloads'

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Runner
//
// Orchestrates a single pipeline execution:
//  1. Load the pipeline record from data_pipelines
//  2. Skip if is_enabled = false
//  3. Look up the registered SourceAdapter
//  4. Create a pipeline_run record (status = 'running')
//  5. Run healthCheck (stores raw health payload)
//  6. Update data_pipelines timestamps + health_status
//  7. Finish the run record (status = success | failed | skipped)
//  8. Log any errors to pipeline_errors
//
// All DB writes fail silently so the runner never crashes the calling cron.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunPipelineOptions {
  db: SupabaseClient
  slug: string
}

export interface RunPipelineResult {
  slug: string
  status: PipelineRunStatus
  runId: string | null
  message: string
  healthyAfterRun: boolean
}

export async function runPipeline({
  db,
  slug,
}: RunPipelineOptions): Promise<RunPipelineResult> {
  // ── 1. Load pipeline record ───────────────────────────────────────────────
  const { data: pipeline, error: pipelineErr } = await db
    .from('data_pipelines')
    .select('is_enabled, status, health_status')
    .eq('slug', slug)
    .single()

  if (pipelineErr || !pipeline) {
    return { slug, status: 'failed', runId: null, healthyAfterRun: false, message: `Pipeline record not found: ${slug}` }
  }

  // ── 2. Skip if disabled ───────────────────────────────────────────────────
  if (!pipeline.is_enabled) {
    return { slug, status: 'skipped', runId: null, healthyAfterRun: false, message: `${slug} is disabled — skipped` }
  }

  // ── 3. Get adapter ────────────────────────────────────────────────────────
  const adapter = getAdapter(slug)
  if (!adapter) {
    await logError(db, slug, null, 'unknown', `No adapter registered for slug: ${slug}`, null, null)
    return { slug, status: 'failed', runId: null, healthyAfterRun: false, message: `No adapter registered for: ${slug}` }
  }

  // ── 4. Create pipeline_run ────────────────────────────────────────────────
  const { data: runRow } = await db
    .from('pipeline_runs')
    .insert({
      pipeline_slug: slug,
      started_at: new Date().toISOString(),
      status: 'running',
    })
    .select('id')
    .single()

  const runId: string | null = runRow?.id ?? null

  let finalStatus: PipelineRunStatus = 'running'
  let healthyAfterRun = false
  let errorCount = 0
  let notes: string | null = null

  try {
    // ── 5. Run healthCheck ──────────────────────────────────────────────────
    const health = await adapter.healthCheck()
    healthyAfterRun = health.healthy

    // Store the raw health response
    await storeHealthPayload(db, slug, runId, health)

    const newHealthStatus = health.healthy ? 'healthy' : 'degraded'
    const now = new Date().toISOString()

    // ── 6. Update data_pipelines timestamps ─────────────────────────────────
    const patchFields: Record<string, unknown> = {
      health_status: newHealthStatus,
      last_checked_at: now,
      updated_at: now,
    }
    if (health.healthy) {
      patchFields.last_success_at = now
      patchFields.last_error_message = null
    }

    await db.from('data_pipelines').update(patchFields).eq('slug', slug)

    finalStatus = health.healthy ? 'success' : 'failed'
    notes = health.message ?? null

    if (!health.healthy) {
      errorCount++
      await logError(
        db, slug, runId,
        health.message?.includes('not yet implemented') ? 'not_implemented' : 'unknown',
        health.message ?? 'Health check returned unhealthy',
        null,
        null
      )
      // Record error timestamp on data_pipelines
      await db.from('data_pipelines').update({
        last_error_at: now,
        last_error_message: health.message ?? 'Health check unhealthy',
        updated_at: now,
      }).eq('slug', slug)
    }

  } catch (err: unknown) {
    errorCount++
    finalStatus = 'failed'

    const errMsg = err instanceof Error ? err.message : String(err)
    const errStack = err instanceof Error ? (err.stack ?? null) : null
    const errType: PipelineErrorType = err instanceof NotImplementedError
      ? 'not_implemented'
      : 'unknown'

    notes = errMsg

    await logError(db, slug, runId, errType, errMsg, errStack, null)

    const now = new Date().toISOString()
    await db.from('data_pipelines').update({
      last_error_at: now,
      last_error_message: errMsg,
      updated_at: now,
    }).eq('slug', slug)
  }

  // ── 7. Finalise the run record ────────────────────────────────────────────
  if (runId) {
    await db.from('pipeline_runs').update({
      finished_at: new Date().toISOString(),
      status: finalStatus,
      error_count: errorCount,
      notes,
    }).eq('id', runId)
  }

  return {
    slug,
    status: finalStatus,
    runId,
    healthyAfterRun,
    message: notes ?? finalStatus,
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function logError(
  db: SupabaseClient,
  slug: string,
  runId: string | null,
  errorType: PipelineErrorType,
  message: string,
  stack: string | null,
  context: Record<string, unknown> | null
): Promise<void> {
  try {
    await db.from('pipeline_errors').insert({
      pipeline_slug: slug,
      run_id: runId,
      error_type: errorType,
      error_message: message,
      error_stack: stack,
      context,
      created_at: new Date().toISOString(),
    })
  } catch {
    // Error logging must never throw
  }
}
