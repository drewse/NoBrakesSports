/**
 * Underdog Fantasy sync — isolated cron.
 *
 * Separate from /api/cron/sync-props because Underdog's single endpoint
 * returns a ~16MB payload that, combined with PrizePicks' 4×7MB and all
 * the sportsbook scrapers, pushed sync-props into OOM / timeout territory
 * (status `---` with no subsequent runs). Giving Underdog its own function
 * isolates that memory footprint — if it OOMs, it only takes itself down,
 * not the whole prop pipeline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeUnderdog } from '@/lib/pipelines/adapters/underdog-props'
import { computePropOddsHash, americanToImpliedProb, type NormalizedProp } from '@/lib/pipelines/prop-normalizer'
import { canonicalEventKey } from '@/lib/pipelines/normalize'

export const runtime = 'nodejs'
export const maxDuration = 120
export const dynamic = 'force-dynamic'

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return secret === process.env.CRON_SECRET || secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
}

function round4(n: number): number { return Math.round(n * 10000) / 10000 }

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // 1) Scrape Underdog
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  let results: Awaited<ReturnType<typeof scrapeUnderdog>> = []
  try {
    results = await scrapeUnderdog(controller.signal)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }

  if (results.length === 0) {
    return NextResponse.json({ ok: true, games: 0, props: 0, matched: 0 })
  }

  // 2) Resolve Underdog source row (auto-create on first run)
  let { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', 'underdog')
    .maybeSingle()
  if (!source) {
    const { data: created } = await db
      .from('market_sources')
      .insert({ name: 'Underdog', slug: 'underdog', source_type: 'dfs', is_active: true })
      .select('id')
      .single()
    source = created
  }
  if (!source) {
    return NextResponse.json({ error: 'failed to resolve underdog market_source' }, { status: 500 })
  }

  // 3) Build event lookup — map canonical key → id so we match on the
  //    same (league, start, home, away) tuple sync-props uses.
  const nowIso = new Date().toISOString()
  const { data: events } = await db
    .from('events')
    .select('id, title, start_time, external_id, leagues(slug)')
    .gt('start_time', nowIso)
    .limit(5000)

  const eventByKey = new Map<string, string>()
  for (const e of (events ?? []) as any[]) {
    const leagueSlug = e.leagues?.slug
    if (!leagueSlug || !e.external_id) continue
    eventByKey.set(e.external_id, e.id as string)
  }

  function findEventId(leagueSlug: string, startTime: string, homeTeam: string, awayTeam: string): string | undefined {
    return eventByKey.get(canonicalEventKey({ leagueSlug, startTime, homeTeam, awayTeam }))
  }

  // 4) Build prop rows
  const sourceId = source.id as string
  const now = new Date().toISOString()
  type PropRow = {
    event_id: string; source_id: string; prop_category: string; player_name: string
    line_value: number | null; over_price: number | null; under_price: number | null
    yes_price: number | null; no_price: number | null
    over_implied_prob: number | null; under_implied_prob: number | null
    odds_hash: string; snapshot_time: string; changed_at: string
  }
  function buildRow(eventId: string, prop: NormalizedProp): PropRow {
    return {
      event_id: eventId,
      source_id: sourceId,
      prop_category: prop.propCategory,
      player_name: prop.playerName,
      line_value: prop.lineValue,
      over_price: prop.overPrice,
      under_price: prop.underPrice,
      yes_price: prop.yesPrice,
      no_price: prop.noPrice,
      over_implied_prob: prop.overPrice != null ? round4(americanToImpliedProb(prop.overPrice)) : null,
      under_implied_prob: prop.underPrice != null ? round4(americanToImpliedProb(prop.underPrice)) : null,
      odds_hash: computePropOddsHash(prop.overPrice, prop.underPrice, prop.yesPrice, prop.noPrice),
      snapshot_time: now,
      changed_at: now,
    }
  }

  let matched = 0
  let unmatched = 0
  const rows: PropRow[] = []
  for (const r of results) {
    const eid = findEventId(r.event.leagueSlug, r.event.startTime, r.event.homeTeam, r.event.awayTeam)
    if (!eid) { unmatched++; continue }
    matched++
    for (const p of r.props) rows.push(buildRow(eid, p))
  }

  // 5) Upsert to prop_odds. Unique key: (source_id, event_id, prop_category, player_name, line_value)
  let inserted = 0
  const errors: string[] = []
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from('prop_odds')
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: 'source_id,event_id,prop_category,player_name,line_value',
      })
    if (error) errors.push(`batch ${Math.floor(i / CHUNK)}: ${error.message}`)
    else inserted += Math.min(CHUNK, rows.length - i)
  }

  await db.from('market_sources').update({ health_status: 'healthy', last_health_check: now }).eq('id', sourceId)

  return NextResponse.json({
    ok: true,
    games: results.length,
    propsScraped: rows.length,
    matched, unmatched,
    inserted,
    errors: errors.length ? errors : undefined,
  })
}
