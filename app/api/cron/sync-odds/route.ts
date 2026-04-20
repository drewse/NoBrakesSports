// GET /api/cron/sync-odds
// Vercel cron — fetches odds from The Odds API across all active sports/regions.
// Controlled by the odds_api_sync feature flag in the admin UI.
//
// Key design decisions (aligned with smart ingestion architecture):
//   - Uses canonicalEventKey() so Odds API events share DB rows with adapter events
//   - Writes to current_market_odds (upsert) for the live query path
//   - Only writes to market_snapshots when odds actually changed (change detection)
//   - Skips unchanged rows to avoid write amplification

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchOddsForSport,
  fetchActiveSportKeys,
  SPORT_KEY_TO_LEAGUE,
  americanToImpliedProb,
  marketKeyToType,
  bookmakerSlug,
  bookmakerDisplayName,
  type OddsGame,
} from '@/lib/data-sync/the-odds-api'
import { canonicalEventKey } from '@/lib/pipelines/normalize'
import {
  computeOddsHash,
  fetchCurrentHashes,
  partitionByChange,
  upsertCurrentOdds,
  type OddsRow,
} from '@/lib/pipelines/change-detection'

export const runtime = 'nodejs'
export const maxDuration = 300

function verifyCron(request: NextRequest) {
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

  // Check feature flag — allows admins to disable from the UI
  const { data: flag } = await db
    .from('feature_flags')
    .select('is_enabled')
    .eq('key', 'odds_api_sync')
    .single()

  if (flag && !flag.is_enabled) {
    return NextResponse.json({ skipped: true, reason: 'odds_api_sync feature flag is disabled' })
  }

  const now = new Date().toISOString()

  const [{ data: leagues }, { data: existingSources }] = await Promise.all([
    db.from('leagues').select('id, slug').eq('is_active', true),
    db.from('market_sources').select('id, slug, name'),
  ])

  const leagueBySlug = Object.fromEntries((leagues ?? []).map((l: any) => [l.slug, l.id]))
  const sourceBySlug: Record<string, string> = Object.fromEntries(
    (existingSources ?? []).map((s: any) => [s.slug, s.id])
  )

  // Only fetch sports that are currently active — saves API credits
  const activeSportKeys = await fetchActiveSportKeys()

  const sportEntries = Object.entries(SPORT_KEY_TO_LEAGUE).filter(
    ([sportKey, slug]) => leagueBySlug[slug] && (activeSportKeys.size === 0 || activeSportKeys.has(sportKey))
  )

  // Fetch in batches of 5 to avoid 429s
  const BATCH_SIZE = 5
  const allGames: Array<{ game: OddsGame; leagueId: string; leagueSlug: string }> = []
  const errors: string[] = []

  for (let i = 0; i < sportEntries.length; i += BATCH_SIZE) {
    const batch = sportEntries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(([sportKey]) => fetchOddsForSport(sportKey))
    )
    results.forEach((result, j) => {
      const [sportKey, leagueSlug] = batch[j]
      if (result.status === 'rejected') {
        errors.push(`${sportKey}: ${result.reason?.message ?? result.reason}`)
        return
      }
      const leagueId = leagueBySlug[leagueSlug]
      result.value.forEach(game => allGames.push({ game, leagueId, leagueSlug }))
    })
    if (i + BATCH_SIZE < sportEntries.length) {
      await new Promise<void>(resolve => setTimeout(resolve, 500))
    }
  }

  // ── Auto-create market_sources for any new bookmaker ────────────────────────
  const seenBookmakers = new Map<string, string>()
  for (const { game } of allGames) {
    for (const bm of game.bookmakers) {
      if (!seenBookmakers.has(bm.key)) seenBookmakers.set(bm.key, bm.title)
    }
  }

  const newSources: object[] = []
  const usedNames = new Set((existingSources ?? []).map((s: any) => s.name ?? ''))

  for (const [key, title] of seenBookmakers) {
    const slug = bookmakerSlug(key)
    if (sourceBySlug[slug]) continue
    let name = bookmakerDisplayName(key, title)
    if (usedNames.has(name)) name = title
    if (usedNames.has(name)) name = `${title} (${slug})`
    usedNames.add(name)
    newSources.push({ slug, name, source_type: 'sportsbook', is_active: true, health_status: 'healthy', display_order: 99 })
  }

  if (newSources.length > 0) {
    const { data: created, error: createErr } = await db
      .from('market_sources')
      .insert(newSources)
      .select('id, slug')
    if (createErr) {
      errors.push(`Auto-create sources: ${createErr.message}`)
    } else {
      for (const s of (created ?? []) as any[]) {
        sourceBySlug[s.slug] = s.id
      }
    }
  }

  if (allGames.length === 0) {
    return NextResponse.json({ ok: true, eventsUpserted: 0, snapshotsInserted: 0, snapshotsSkipped: 0, newSourcesCreated: newSources.length, errors: errors.length ? errors : undefined })
  }

  // ── Upsert events using canonical keys ──────────────────────────────────────
  // canonicalEventKey produces "{league}:{date}:{home}:{away}" — same format
  // as our pipeline adapters, so Odds API events merge with adapter events
  // into ONE events row per game instead of creating duplicates.
  // Skip parlay / multi-game placeholders from the Odds API (e.g. the feed
  // sometimes returns a row whose home_team is literally "Home Teams (4
  // Games)" for a daily-parlay wager). They pollute the events table with
  // fake matchups that break the duplicate-detection logic elsewhere.
  const isPlaceholderTeam = (name: string | undefined): boolean => {
    if (!name) return true
    const t = name.trim()
    if (/\(\d+\s*Games?\)/i.test(t)) return true
    if (/^home teams?$/i.test(t) || /^away teams?$/i.test(t)) return true
    if (/^home teams?\s/i.test(t) || /^away teams?\s/i.test(t)) return true
    return false
  }
  const eventsToUpsert = allGames
    .filter(({ game }) => !isPlaceholderTeam(game.home_team) && !isPlaceholderTeam(game.away_team))
    .map(({ game, leagueId, leagueSlug }) => ({
      external_id: canonicalEventKey({
        leagueSlug,
        homeTeam: game.home_team,
        awayTeam: game.away_team,
        startTime: game.commence_time,
      }),
      league_id: leagueId,
      title: `${game.home_team} vs ${game.away_team}`,
      start_time: game.commence_time,
      status: 'scheduled',
    }))

  const { data: upsertedEvents, error: eventsError } = await db
    .from('events')
    .upsert(eventsToUpsert, { onConflict: 'external_id', ignoreDuplicates: false })
    .select('id, external_id')

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 })
  }

  const eventIdByCanonicalKey = Object.fromEntries(
    (upsertedEvents ?? []).map((e: any) => [e.external_id, e.id])
  )

  // ── Build OddsRows ───────────────────────────────────────────────────────────
  const allOddsRows: OddsRow[] = []

  for (const { game, leagueSlug } of allGames) {
    const canonicalKey = canonicalEventKey({
      leagueSlug,
      homeTeam: game.home_team,
      awayTeam: game.away_team,
      startTime: game.commence_time,
    })
    const eventId = eventIdByCanonicalKey[canonicalKey]
    if (!eventId) continue

    for (const bookmaker of game.bookmakers) {
      const slug = bookmakerSlug(bookmaker.key)
      const sourceId = sourceBySlug[slug]
      if (!sourceId) continue

      for (const market of bookmaker.markets.filter(m => ['h2h', 'spreads', 'totals'].includes(m.key))) {
        const home = market.outcomes.find(o => o.name === game.home_team)
        const away = market.outcomes.find(o => o.name === game.away_team)
        const draw = market.outcomes.find(o => o.name === 'Draw')
        const over = market.outcomes.find(o => o.name === 'Over')
        const under = market.outcomes.find(o => o.name === 'Under')
        const mtype = marketKeyToType(market.key) as 'moneyline' | 'spread' | 'total'

        allOddsRows.push({
          event_id:           eventId,
          source_id:          sourceId,
          market_type:        mtype,
          home_price:         home?.price ?? null,
          away_price:         away?.price ?? null,
          draw_price:         draw?.price ?? null,
          spread_value:       mtype === 'spread' ? (home?.point ?? null) : null,
          total_value:        mtype === 'total'  ? (over?.point  ?? null) : null,
          over_price:         over?.price  ?? null,
          under_price:        under?.price ?? null,
          home_implied_prob:  home ? americanToImpliedProb(home.price) : null,
          away_implied_prob:  away ? americanToImpliedProb(away.price) : null,
          movement_direction: 'flat',
          snapshot_time:      now,
        })
      }
    }
  }

  // ── Change detection ─────────────────────────────────────────────────────────
  // One batch query per source to fetch existing hashes.
  // Group rows by source_id so we can batch the hash lookups.
  const rowsBySource = new Map<string, OddsRow[]>()
  for (const row of allOddsRows) {
    if (!rowsBySource.has(row.source_id)) rowsBySource.set(row.source_id, [])
    rowsBySource.get(row.source_id)!.push(row)
  }

  const allChanged: OddsRow[] = []
  const allUnchanged: OddsRow[] = []

  for (const [sourceId, rows] of rowsBySource) {
    const eventIds = [...new Set(rows.map(r => r.event_id))]
    const existingHashes = await fetchCurrentHashes(db, eventIds, sourceId)
    const { changed, unchanged } = partitionByChange(rows, existingHashes)
    allChanged.push(...changed)
    allUnchanged.push(...unchanged)
  }

  // ── Upsert current_market_odds (all rows) ────────────────────────────────────
  const { errors: cmoErrors } = await upsertCurrentOdds(db, allChanged, allUnchanged, now)
  errors.push(...cmoErrors)

  // ── Insert market_snapshots only for changed rows ────────────────────────────
  let snapshotsInserted = 0
  if (allChanged.length > 0) {
    const CHUNK = 500
    for (let i = 0; i < allChanged.length; i += CHUNK) {
      const slice = allChanged.slice(i, i + CHUNK)
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
            snapshot_time:      now,
            odds_hash:          row.odds_hash,
          })),
          { count: 'exact' }
        )
      if (error) errors.push(`market_snapshots: ${error.message}`)
      else snapshotsInserted += count ?? slice.length
    }
  }

  // Mark all seen sources as healthy
  const allSeenSlugs = Array.from(seenBookmakers.keys()).map(bookmakerSlug)
  await db
    .from('market_sources')
    .update({ health_status: 'healthy', updated_at: now })
    .in('slug', allSeenSlugs)

  return NextResponse.json({
    ok: true,
    eventsUpserted:    upsertedEvents?.length ?? 0,
    snapshotsInserted,
    snapshotsSkipped:  allUnchanged.length,
    newSourcesCreated: newSources.length,
    booksSeenThisRun:  allSeenSlugs.length,
    errors:            errors.length ? errors : undefined,
  })
}
