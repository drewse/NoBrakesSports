/**
 * Fanatics Markets sync — isolated cron.
 *
 * Public REST endpoint, no proxy needed, no auth. Pulls NBA/MLB/NHL/NFL
 * events from api.fanaticsmarkets.com, converts probabilities → American
 * odds, matches canonical events by league + sorted team-pair + day.
 * Never auto-creates events.
 *
 * At time of wiring, Fanatics Markets' REST response ships every outcome
 * with probability=0.5 — live trading probably goes over WebSocket. The
 * adapter runs anyway so the moment real prices land in REST we capture
 * them. Monitor the admin page for a sudden rise in non-pick'em rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeFanaticsMarkets } from '@/lib/pipelines/adapters/fanatics-markets'
import { americanToImpliedProb } from '@/lib/pipelines/prop-normalizer'

export const runtime = 'nodejs'
export const maxDuration = 60
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
  const timer = setTimeout(() => controller.abort(), 45_000)
  let results: Awaited<ReturnType<typeof scrapeFanaticsMarkets>> = []
  try {
    results = await scrapeFanaticsMarkets(controller.signal)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }

  // Resolve (or create) source row.
  let { data: source } = await db
    .from('market_sources').select('id').eq('slug', 'fanatics_markets').maybeSingle()
  if (!source) {
    const { data: created } = await db
      .from('market_sources')
      .insert({ name: 'Fanatics Markets', slug: 'fanatics_markets', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    source = created
  }
  if (!source) return NextResponse.json({ error: 'failed to resolve source' }, { status: 500 })
  const sourceId = source.id as string

  const nowIso = new Date().toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, league_id, leagues(slug)')
    .gt('start_time', nowIso)
    .limit(5000)

  const pairKey = (a: string, b: string) =>
    [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join('|')
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
      currentOddsByKey.set(`${eid}|${gm.marketType}`, {
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

  // Nuke existing Fanatics current_market_odds before upserting fresh
  // ones. Upsert alone leaves stale rows orphaned — e.g. a +100 row for
  // an event whose latest scrape produced no valid prices (placeholder
  // filter rejected it) sticks around forever, surfacing as phantom
  // arbs. sync-polymarket uses the same clear-then-insert pattern.
  const { error: clearErr } = await db
    .from('current_market_odds')
    .delete()
    .eq('source_id', sourceId)
  if (clearErr) errors.push(`cmo clear: ${clearErr.message}`)

  const currentOddsRows = [...currentOddsByKey.values()]
  let currentOddsUpserted = 0
  for (let i = 0; i < currentOddsRows.length; i += 200) {
    const { error } = await db
      .from('current_market_odds')
      .upsert(currentOddsRows.slice(i, i + 200), { onConflict: 'event_id,source_id,market_type,line_value' })
    if (error) errors.push(`cmo ${Math.floor(i/200)}: ${error.message}`)
    else currentOddsUpserted += Math.min(200, currentOddsRows.length - i)
  }

  await db.from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now }).eq('id', sourceId)

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
