/**
 * Bovada sync — isolated cron.
 *
 * Writes moneyline / spread / total snapshots into both current_market_odds
 * (the live table the UI reads) and market_snapshots (history). Matches
 * events by league + sorted team pair + same calendar day, without
 * auto-creating events (Bovada sometimes lists games early; we follow the
 * same Kalshi policy of only writing when a sportsbook has posted the
 * canonical event).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeBovada, type BovadaGameMarket } from '@/lib/pipelines/adapters/bovada'
import { americanToImpliedProb } from '@/lib/pipelines/prop-normalizer'

export const runtime = 'nodejs'
export const maxDuration = 60
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
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  let results: Awaited<ReturnType<typeof scrapeBovada>> = []
  try {
    results = await scrapeBovada(controller.signal)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }

  // Resolve source row (auto-create on first run)
  let { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', 'bovada')
    .maybeSingle()
  if (!source) {
    const { data: created } = await db
      .from('market_sources')
      .insert({ name: 'Bovada', slug: 'bovada', source_type: 'sportsbook', is_active: true })
      .select('id')
      .single()
    source = created
  }
  if (!source) {
    return NextResponse.json({ error: 'failed to resolve bovada market_source' }, { status: 500 })
  }
  const sourceId = source.id as string

  // Fetch upcoming canonical events once.
  const nowIso = new Date().toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, league_id, leagues(slug)')
    .gt('start_time', nowIso)
    .limit(5000)

  function pairKey(a: string, b: string) {
    return [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join('|')
  }

  // Group events by (league, sorted-pair, YYYY-MM-DD) so we match even
  // if home/away order differs between Bovada and canonical title.
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
  let matched = 0
  let unmatched = 0
  const byLeague: Record<string, number> = {}

  for (const r of results) {
    const day = r.event.startTime.slice(0, 10)
    const eid = eventByKey.get(`${r.event.leagueSlug}|${pairKey(r.event.homeTeam, r.event.awayTeam)}|${day}`)
    if (!eid) { unmatched++; continue }
    matched++
    byLeague[r.event.leagueSlug] = (byLeague[r.event.leagueSlug] ?? 0) + 1

    for (const gm of r.gameMarkets) {
      const oddsHash = [gm.homePrice, gm.awayPrice, null, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
        .map(v => v ?? '').join('|')
      const row = {
        event_id: eid,
        source_id: sourceId,
        market_type: gm.marketType,
        line_value: 0,
        odds_hash: oddsHash,
        home_price: gm.homePrice,
        away_price: gm.awayPrice,
        draw_price: null,
        spread_value: gm.spreadValue,
        total_value: gm.totalValue,
        over_price: gm.overPrice,
        under_price: gm.underPrice,
        home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
        away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
        movement_direction: 'flat',
        snapshot_time: now,
        changed_at: now,
      }
      marketSnapshots.push(row)
      currentOddsByKey.set(`${eid}|${gm.marketType}`, row)
    }
  }

  // History log
  const errors: string[] = []
  let marketInserted = 0
  for (let i = 0; i < marketSnapshots.length; i += 200) {
    const { error } = await db
      .from('market_snapshots')
      .insert(marketSnapshots.slice(i, i + 200))
    if (error) errors.push(`market batch ${Math.floor(i / 200)}: ${error.message}`)
    else marketInserted += Math.min(200, marketSnapshots.length - i)
  }

  // Live table — already deduped by (event_id, market_type) via the Map.
  const currentOddsRows = [...currentOddsByKey.values()]
  let currentOddsUpserted = 0
  for (let i = 0; i < currentOddsRows.length; i += 200) {
    const { error } = await db
      .from('current_market_odds')
      .upsert(currentOddsRows.slice(i, i + 200), {
        onConflict: 'event_id,source_id,market_type,line_value',
      })
    if (error) errors.push(`cmo batch ${Math.floor(i / 200)}: ${error.message}`)
    else currentOddsUpserted += Math.min(200, currentOddsRows.length - i)
  }

  await db.from('market_sources').update({ health_status: 'healthy', last_health_check: now }).eq('id', sourceId)

  return NextResponse.json({
    ok: true,
    events: results.length,
    matched, unmatched,
    marketsBuilt: marketSnapshots.length,
    marketSnapshotsInserted: marketInserted,
    currentOddsUpserted,
    byLeague,
    errors: errors.length ? errors : undefined,
  })
}
