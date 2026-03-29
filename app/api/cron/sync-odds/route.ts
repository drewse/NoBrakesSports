import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchOddsForSport,
  SPORT_KEY_TO_LEAGUE,
  americanToImpliedProb,
  marketKeyToType,
  bookmakerSlug,
  bookmakerDisplayName,
  type OddsGame,
} from '@/lib/data-sync/the-odds-api'

export const runtime = 'nodejs'
export const maxDuration = 60

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
  const now = new Date().toISOString()

  const [{ data: leagues }, { data: existingSources }] = await Promise.all([
    db.from('leagues').select('id, slug').eq('is_active', true),
    db.from('market_sources').select('id, slug'),
  ])

  const leagueBySlug = Object.fromEntries((leagues ?? []).map(l => [l.slug, l.id]))
  // Mutable map — we'll add new sources to this as we auto-create them
  const sourceBySlug: Record<string, string> = Object.fromEntries(
    (existingSources ?? []).map(s => [s.slug, s.id])
  )

  // Fetch all sports in parallel
  const sportEntries = Object.entries(SPORT_KEY_TO_LEAGUE).filter(
    ([, slug]) => leagueBySlug[slug]
  )

  const results = await Promise.allSettled(
    sportEntries.map(([sportKey]) => fetchOddsForSport(sportKey))
  )

  const allGames: Array<{ game: OddsGame; leagueId: string }> = []
  const errors: string[] = []

  results.forEach((result, i) => {
    const [sportKey, leagueSlug] = sportEntries[i]
    if (result.status === 'rejected') {
      errors.push(`${sportKey}: ${result.reason?.message ?? result.reason}`)
      return
    }
    const leagueId = leagueBySlug[leagueSlug]
    result.value.forEach(game => allGames.push({ game, leagueId }))
  })

  // ── Auto-create market_sources for any new bookmaker ──────────────────────
  // Collect every bookmaker key seen across all games
  const seenBookmakers = new Map<string, string>() // key -> title
  for (const { game } of allGames) {
    for (const bm of game.bookmakers) {
      if (!seenBookmakers.has(bm.key)) seenBookmakers.set(bm.key, bm.title)
    }
  }

  const newSources: Array<{ slug: string; name: string; source_type: string; is_active: boolean; health_status: string; display_order: number }> = []
  for (const [key, title] of seenBookmakers) {
    const slug = bookmakerSlug(key)
    if (!sourceBySlug[slug]) {
      newSources.push({
        slug,
        name: bookmakerDisplayName(key, title),
        source_type: 'sportsbook',
        is_active: true,
        health_status: 'healthy',
        display_order: 99, // new sources go to the end
      })
    }
  }

  if (newSources.length > 0) {
    const { data: created, error: createErr } = await db
      .from('market_sources')
      .insert(newSources)
      .select('id, slug')
    if (createErr) {
      errors.push(`Auto-create sources: ${createErr.message}`)
    } else {
      for (const s of created ?? []) {
        sourceBySlug[s.slug] = s.id
      }
    }
  }

  if (allGames.length === 0) {
    return NextResponse.json({
      ok: true, eventsUpserted: 0, snapshotsInserted: 0, newSourcesCreated: 0,
      debug: {
        leagueCount: leagues?.length ?? 0,
        sourceCount: existingSources?.length ?? 0,
        sportEntriesCount: sportEntries.length,
        sportEntries: sportEntries.map(([k, v]) => `${k}→${v}`),
        resultsStatuses: results.map((r, i) => ({
          sport: sportEntries[i]?.[0],
          status: r.status,
          gameCount: r.status === 'fulfilled' ? r.value.length : undefined,
          reason: r.status === 'rejected' ? String(r.reason) : undefined,
        })),
      },
      errors: errors.length ? errors : undefined,
    })
  }

  // ── Bulk upsert events ───────────────────────────────────────────────────
  const { data: upsertedEvents, error: eventsError } = await db
    .from('events')
    .upsert(
      allGames.map(({ game, leagueId }) => ({
        external_id: game.id,
        league_id: leagueId,
        title: `${game.home_team} vs ${game.away_team}`,
        start_time: game.commence_time,
        status: 'scheduled',
      })),
      { onConflict: 'external_id', ignoreDuplicates: false }
    )
    .select('id, external_id')

  if (eventsError) {
    return NextResponse.json({ error: eventsError.message }, { status: 500 })
  }

  const eventIdByExternalId = Object.fromEntries(
    (upsertedEvents ?? []).map(e => [e.external_id, e.id])
  )

  // ── Build and insert snapshots ───────────────────────────────────────────
  const snapshots: object[] = []

  for (const { game } of allGames) {
    const eventId = eventIdByExternalId[game.id]
    if (!eventId) continue

    for (const bookmaker of game.bookmakers) {
      const slug = bookmakerSlug(bookmaker.key)
      const sourceId = sourceBySlug[slug]
      if (!sourceId) continue

      for (const market of bookmaker.markets) {
        const home = market.outcomes.find(o => o.name === game.home_team)
        const away = market.outcomes.find(o => o.name === game.away_team)
        const draw = market.outcomes.find(o => o.name === 'Draw')
        const over = market.outcomes.find(o => o.name === 'Over')

        snapshots.push({
          event_id: eventId,
          source_id: sourceId,
          market_type: marketKeyToType(market.key),
          home_price: home?.price ?? over?.price ?? null,
          away_price: away?.price ?? null,
          draw_price: draw?.price ?? null,
          spread_value: home?.point ?? null,
          total_value: over?.point ?? null,
          home_implied_prob: home ? americanToImpliedProb(home.price) : null,
          away_implied_prob: away ? americanToImpliedProb(away.price) : null,
          movement_direction: 'flat',
          snapshot_time: now,
        })
      }
    }
  }

  let snapshotsInserted = 0
  const chunkSize = 500
  for (let i = 0; i < snapshots.length; i += chunkSize) {
    const chunk = snapshots.slice(i, i + chunkSize)
    const { error } = await db.from('market_snapshots').insert(chunk)
    if (error) {
      errors.push(`Snapshot batch ${i / chunkSize}: ${error.message}`)
    } else {
      snapshotsInserted += chunk.length
    }
  }

  // Mark all seen sources as healthy
  const allSeenSlugs = Array.from(seenBookmakers.keys()).map(bookmakerSlug)
  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now })
    .in('slug', allSeenSlugs)

  return NextResponse.json({
    ok: true,
    eventsUpserted: upsertedEvents?.length ?? 0,
    snapshotsInserted,
    newSourcesCreated: newSources.length,
    booksSeenThisRun: allSeenSlugs.length,
    errors: errors.length ? errors : undefined,
  })
}
