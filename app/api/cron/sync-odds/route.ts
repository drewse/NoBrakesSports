import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchOddsForSport,
  SPORT_KEY_TO_LEAGUE,
  BOOKMAKER_TO_SOURCE,
  americanToImpliedProb,
  marketKeyToType,
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

  const [{ data: leagues }, { data: sources }] = await Promise.all([
    db.from('leagues').select('id, slug').eq('is_active', true),
    db.from('market_sources').select('id, slug').eq('is_active', true),
  ])

  const leagueBySlug = Object.fromEntries((leagues ?? []).map(l => [l.slug, l.id]))
  const sourceBySlug = Object.fromEntries((sources ?? []).map(s => [s.slug, s.id]))

  // Fetch all sports in parallel
  const sportEntries = Object.entries(SPORT_KEY_TO_LEAGUE).filter(
    ([, slug]) => leagueBySlug[slug]
  )

  const results = await Promise.allSettled(
    sportEntries.map(([sportKey]) => fetchOddsForSport(sportKey))
  )

  // Collect all event upserts
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

  if (allGames.length === 0) {
    return NextResponse.json({ ok: true, eventsUpserted: 0, snapshotsInserted: 0, errors: errors.length ? errors : undefined })
  }

  // Bulk upsert events
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

  // Build all snapshots in memory, then bulk insert
  const snapshots: object[] = []

  for (const { game } of allGames) {
    const eventId = eventIdByExternalId[game.id]
    if (!eventId) continue

    for (const bookmaker of game.bookmakers) {
      const sourceSlug = BOOKMAKER_TO_SOURCE[bookmaker.key]
      const sourceId = sourceSlug ? sourceBySlug[sourceSlug] : null
      if (!sourceId) continue

      for (const market of bookmaker.markets) {
        const home = market.outcomes.find(o => o.name === game.home_team)
        const away = market.outcomes.find(o => o.name === game.away_team)
        const over = market.outcomes.find(o => o.name === 'Over')

        snapshots.push({
          event_id: eventId,
          source_id: sourceId,
          market_type: marketKeyToType(market.key),
          home_price: home?.price ?? over?.price ?? null,
          away_price: away?.price ?? null,
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

  // Insert in chunks of 500 to avoid payload limits
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

  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now })
    .in('slug', Object.values(BOOKMAKER_TO_SOURCE))

  return NextResponse.json({
    ok: true,
    eventsUpserted: upsertedEvents?.length ?? 0,
    snapshotsInserted,
    errors: errors.length ? errors : undefined,
  })
}
