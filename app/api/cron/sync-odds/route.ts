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

  // Load leagues and sources from DB
  const [{ data: leagues }, { data: sources }] = await Promise.all([
    db.from('leagues').select('id, slug').eq('is_active', true),
    db.from('market_sources').select('id, slug').eq('is_active', true),
  ])

  const leagueBySlug = Object.fromEntries((leagues ?? []).map(l => [l.slug, l.id]))
  const sourceBySlug = Object.fromEntries((sources ?? []).map(s => [s.slug, s.id]))

  let snapshotsInserted = 0
  let eventsUpserted = 0
  const errors: string[] = []

  for (const [sportKey, leagueSlug] of Object.entries(SPORT_KEY_TO_LEAGUE)) {
    const leagueId = leagueBySlug[leagueSlug]
    if (!leagueId) continue

    let games: OddsGame[]
    try {
      games = await fetchOddsForSport(sportKey)
    } catch (err) {
      errors.push(`${sportKey}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    for (const game of games) {
      // Upsert event by external_id
      const { data: event, error: eventError } = await db
        .from('events')
        .upsert(
          {
            external_id: game.id,
            league_id: leagueId,
            title: `${game.home_team} vs ${game.away_team}`,
            start_time: game.commence_time,
            status: 'scheduled',
          },
          { onConflict: 'external_id', ignoreDuplicates: false }
        )
        .select('id')
        .single()

      if (eventError || !event) {
        errors.push(`Event upsert failed for ${game.id}: ${eventError?.message}`)
        continue
      }
      eventsUpserted++

      const now = new Date().toISOString()

      // Insert snapshots for each bookmaker + market
      for (const bookmaker of game.bookmakers) {
        const sourceSlug = BOOKMAKER_TO_SOURCE[bookmaker.key]
        const sourceId = sourceSlug ? sourceBySlug[sourceSlug] : null
        if (!sourceId) continue

        for (const market of bookmaker.markets) {
          const marketType = marketKeyToType(market.key)
          const home = market.outcomes.find(o => o.name === game.home_team)
          const away = market.outcomes.find(o => o.name === game.away_team)
          const over = market.outcomes.find(o => o.name === 'Over')
          const under = market.outcomes.find(o => o.name === 'Under')

          const { error: snapError } = await db.from('market_snapshots').insert({
            event_id: event.id,
            source_id: sourceId,
            market_type: marketType,
            home_price: home?.price ?? over?.price ?? null,
            away_price: away?.price ?? under?.price ?? null,
            spread_value: home?.point ?? null,
            total_value: over?.point ?? null,
            home_implied_prob: home ? americanToImpliedProb(home.price) : null,
            away_implied_prob: away ? americanToImpliedProb(away.price) : null,
            movement_direction: 'flat',
            snapshot_time: now,
          })

          if (snapError) {
            errors.push(`Snapshot insert failed: ${snapError.message}`)
          } else {
            snapshotsInserted++
          }
        }
      }
    }
  }

  // Update health status for synced sources
  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: new Date().toISOString() })
    .in('slug', Object.values(BOOKMAKER_TO_SOURCE))

  return NextResponse.json({
    ok: true,
    eventsUpserted,
    snapshotsInserted,
    errors: errors.length > 0 ? errors : undefined,
  })
}
