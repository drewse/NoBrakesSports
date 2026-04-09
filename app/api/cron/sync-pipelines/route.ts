// GET /api/cron/sync-pipelines
// Vercel cron — runs all enabled, non-running sportsbook pipelines.
// Triggered by vercel.json cron schedule.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ingestPipeline } from '@/lib/pipelines/ingest'

export const runtime = 'nodejs'
export const maxDuration = 300

function verifyCron(request: NextRequest): boolean {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return (
    secret === process.env.CRON_SECRET ||
    secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Skip pipelines that are already running — they hold the lock and will
  // be skipped by acquirePipelineLock anyway, but filtering here avoids
  // spawning work for them at all.
  const { data: enabledPipelines } = await db
    .from('data_pipelines')
    .select('slug')
    .eq('is_enabled', true)
    .eq('is_running', false)
    .order('priority', { ascending: true })

  const slugs = (enabledPipelines ?? []).map((p: any) => p.slug)

  const results = []
  let totalEvents = 0
  let totalSnapshots = 0

  for (const slug of slugs) {
    try {
      const result = await ingestPipeline(db, slug, { triggerSource: 'cron' })
      totalEvents    += result.eventsUpserted
      totalSnapshots += result.snapshotsInserted
      results.push(result)
    } catch (e: any) {
      results.push({ slug, error: e.message })
    }
  }

  return NextResponse.json({
    ok: true,
    pipelinesRun:          slugs.length,
    totalEventsUpserted:   totalEvents,
    totalSnapshotsInserted: totalSnapshots,
    results,
  })
}
