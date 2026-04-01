// GET /api/cron/sync-pipelines
// Vercel cron — runs all enabled sportsbook pipelines to collect odds.
// Triggered by vercel.json cron schedule.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ingestPipeline } from '@/lib/pipelines/ingest'

export const runtime = 'nodejs'
export const maxDuration = 60

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

  const { data: enabledPipelines } = await db
    .from('data_pipelines')
    .select('slug')
    .eq('is_enabled', true)
    .order('priority', { ascending: true })

  const slugs = (enabledPipelines ?? []).map((p: any) => p.slug)

  const results = []
  let totalEvents = 0
  let totalSnapshots = 0

  for (const slug of slugs) {
    try {
      const result = await ingestPipeline(db, slug)
      totalEvents += result.eventsUpserted
      totalSnapshots += result.snapshotsInserted
      results.push(result)
    } catch (e: any) {
      results.push({ slug, error: e.message })
    }
  }

  return NextResponse.json({
    ok: true,
    pipelinesRun: slugs.length,
    totalEventsUpserted: totalEvents,
    totalSnapshotsInserted: totalSnapshots,
    results,
  })
}
