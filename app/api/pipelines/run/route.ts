// POST /api/pipelines/run
// Admin-only. Triggers a full ingest (fetchEvents + DB write) for one or all pipelines.
//
// Body: { slug: string }        — run a single pipeline
//   or: { slug: 'all' }         — run all enabled pipelines (use with caution)
//
// Returns: IngestResult | IngestResult[]

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { ingestPipeline } from '@/lib/pipelines/ingest'
import { ALL_PIPELINE_SLUGS } from '@/lib/pipelines/registry'

export const runtime = 'nodejs'
export const maxDuration = 60

async function isAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll() } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const db = createAdminClient()
    const { data } = await db.from('profiles').select('is_admin').eq('id', user.id).single()
    return data?.is_admin === true
  } catch {
    return false
  }
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let slug: string
  try {
    const body = await request.json()
    slug = body.slug
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }

  const db = createAdminClient()

  // Run a single pipeline
  if (slug !== 'all') {
    if (!ALL_PIPELINE_SLUGS.includes(slug as any)) {
      return NextResponse.json({ error: `Unknown slug: ${slug}` }, { status: 400 })
    }
    try {
      const result = await ingestPipeline(db, slug)
      return NextResponse.json(result)
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  // Run all enabled pipelines sequentially (avoid hammering everything at once)
  const { data: enabledPipelines } = await db
    .from('data_pipelines')
    .select('slug')
    .eq('is_enabled', true)

  const slugsToRun = (enabledPipelines ?? []).map((p: any) => p.slug)
  const results = []

  for (const s of slugsToRun) {
    try {
      const result = await ingestPipeline(db, s)
      results.push(result)
    } catch (e: any) {
      results.push({ slug: s, error: e.message })
    }
  }

  return NextResponse.json(results)
}
