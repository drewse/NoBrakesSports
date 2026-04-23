/**
 * BetOnline / LowVig sync — isolated cron.
 *
 * The scraper hits a Cloudflare-protected API (api-offering.betonline.ag)
 * that 403s datacenter IPs but accepts PacketStream residential. Writes
 * moneyline / spread / total to both current_market_odds (live UI) and
 * market_snapshots (history). Matches canonical events by sorted team
 * pair + day; does NOT auto-create.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeBetOnline, __lastScrapeStats as betonlineStats, BETONLINE_OPERATORS } from '@/lib/pipelines/adapters/betonline'
import { americanToImpliedProb } from '@/lib/pipelines/prop-normalizer'

export const runtime = 'nodejs'
export const maxDuration = 90
export const dynamic = 'force-dynamic'

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return secret === process.env.CRON_SECRET || secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
}
function round4(n: number) { return Math.round(n * 10000) / 10000 }

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 75_000)
  let results: Awaited<ReturnType<typeof scrapeBetOnline>> = []
  try {
    results = await scrapeBetOnline(controller.signal)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }

  // Resolve (and auto-create) source rows for each operator.
  const sourceIdBySlug = new Map<string, string>()
  for (const op of BETONLINE_OPERATORS) {
    let { data: src } = await db
      .from('market_sources').select('id').eq('slug', op.slug).maybeSingle()
    if (!src) {
      const { data: created } = await db
        .from('market_sources')
        .insert({ name: op.name, slug: op.slug, source_type: 'sportsbook', is_active: true })
        .select('id').single()
      src = created
    }
    if (src) sourceIdBySlug.set(op.slug, src.id as string)
  }

  // Canonical events lookup
  const nowIso = new Date().toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, league_id, leagues(slug)')
    .gt('start_time', nowIso)
    .limit(5000)

  function pairKey(a: string, b: string) {
    return [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join('|')
  }
  const eventByKey = new Map<string, string>()
  for (const e of (dbEvents ?? []) as any[]) {
    const slug = e.leagues?.slug
    const title = e.title as string
    if (!slug || !title) continue
    const parts = title.split(/\s+vs\.?\s+/i)
    if (parts.length !== 2) continue
    const day = String(e.start_time).slice(0, 10)
    eventByKey.set(`${slug}|${pairKey(parts[0], parts[1])}|${day}`, e.id as string)
  }

  const now = new Date().toISOString()
  const marketSnapshots: any[] = []
  const currentOddsByKey = new Map<string, any>()
  const perOp: Record<string, { matched: number; unmatched: number; markets: number }> = {}

  for (const r of results) {
    const sourceId = sourceIdBySlug.get(r.operatorSlug)
    if (!sourceId) continue
    perOp[r.operatorSlug] ??= { matched: 0, unmatched: 0, markets: 0 }

    const day = r.event.startTime.slice(0, 10)
    const eid = eventByKey.get(`${r.event.leagueSlug}|${pairKey(r.event.homeTeam, r.event.awayTeam)}|${day}`)
    if (!eid) { perOp[r.operatorSlug].unmatched++; continue }
    perOp[r.operatorSlug].matched++

    for (const gm of r.gameMarkets) {
      perOp[r.operatorSlug].markets++
      const oddsHash = [gm.homePrice, gm.awayPrice, null, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
        .map(v => v ?? '').join('|')
      const homeProb = gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null
      const awayProb = gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null
      marketSnapshots.push({
        event_id: eid, source_id: sourceId, market_type: gm.marketType,
        home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: null,
        spread_value: gm.spreadValue, total_value: gm.totalValue,
        over_price: gm.overPrice, under_price: gm.underPrice,
        home_implied_prob: homeProb, away_implied_prob: awayProb,
        snapshot_time: now,
      })
      currentOddsByKey.set(`${eid}|${sourceId}|${gm.marketType}`, {
        event_id: eid, source_id: sourceId, market_type: gm.marketType,
        line_value: 0, odds_hash: oddsHash,
        home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: null,
        spread_value: gm.spreadValue, total_value: gm.totalValue,
        over_price: gm.overPrice, under_price: gm.underPrice,
        home_implied_prob: homeProb, away_implied_prob: awayProb,
        movement_direction: 'flat',
        snapshot_time: now, changed_at: now,
      })
    }
  }

  const errors: string[] = []
  let marketInserted = 0
  for (let i = 0; i < marketSnapshots.length; i += 200) {
    const { error } = await db
      .from('market_snapshots').insert(marketSnapshots.slice(i, i + 200))
    if (error) errors.push(`market ${Math.floor(i/200)}: ${error.message}`)
    else marketInserted += Math.min(200, marketSnapshots.length - i)
  }

  const currentOddsRows = [...currentOddsByKey.values()]
  let currentOddsUpserted = 0
  for (let i = 0; i < currentOddsRows.length; i += 200) {
    const { error } = await db
      .from('current_market_odds')
      .upsert(currentOddsRows.slice(i, i + 200), { onConflict: 'event_id,source_id,market_type,line_value' })
    if (error) errors.push(`cmo ${Math.floor(i/200)}: ${error.message}`)
    else currentOddsUpserted += Math.min(200, currentOddsRows.length - i)
  }

  for (const [slug, id] of sourceIdBySlug) {
    await db.from('market_sources')
      .update({ health_status: 'healthy', last_health_check: now }).eq('id', id)
  }

  return NextResponse.json({
    ok: true,
    totalResults: results.length,
    perOp,
    marketsBuilt: marketSnapshots.length,
    marketInserted,
    currentOddsUpserted,
    adapterStats: betonlineStats,
    errors: errors.length ? errors : undefined,
  })
}
