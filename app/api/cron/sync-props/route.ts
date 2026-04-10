// GET /api/cron/sync-props
// Vercel cron — scrapes EVERY prop from Kambi (BetRivers ON) and Pinnacle
// every 2 minutes. Free, unlimited, no API keys.
//
// Architecture:
//   1. Scrape Kambi + Pinnacle in parallel (all sports, all events, all props)
//   2. Match scraped events to DB events via canonical event key
//   3. Upsert into prop_odds with change detection (odds_hash)
//   4. Only write to prop_snapshots when odds actually changed

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeKambiProps, type KambiPropResult } from '@/lib/pipelines/adapters/kambi-props'
import { scrapePinnacleProps, type PinnaclePropResult } from '@/lib/pipelines/adapters/pinnacle-props'
import { computePropOddsHash, americanToImpliedProb } from '@/lib/pipelines/prop-normalizer'
import type { NormalizedProp } from '@/lib/pipelines/prop-normalizer'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

// Map Kambi sport paths to our DB league slugs
const KAMBI_PATH_TO_LEAGUE: Record<string, string> = {
  'basketball/nba': 'nba',
  'baseball/mlb': 'mlb',
  'ice_hockey/nhl': 'nhl',
  'football/england': 'epl',
  'football/spain': 'laliga',
  'football/germany': 'bundesliga',
  'football/italy': 'seria_a',
  'football/france': 'ligue_one',
  'football/mexico': 'liga_mx',
  'football/copa_libertadores': 'copa_libertadores',
  'football/copa_sudamericana': 'copa_sudamericana',
}

// Map Pinnacle league names to our DB league slugs
const PINNACLE_LEAGUE_TO_SLUG: Record<string, string> = {
  'NBA': 'nba',
  'MLB': 'mlb',
  'NHL': 'nhl',
  'EPL': 'epl',
  'La Liga': 'laliga',
  'Bundesliga': 'bundesliga',
  'Serie A': 'seria_a',
  'Ligue 1': 'ligue_one',
  'Liga MX': 'liga_mx',
  'Copa Libertadores': 'copa_libertadores',
}

interface PropRow {
  event_id: string
  source_id: string
  prop_category: string
  player_name: string
  line_value: number | null
  over_price: number | null
  under_price: number | null
  yes_price: number | null
  no_price: number | null
  over_implied_prob: number | null
  under_implied_prob: number | null
  odds_hash: string
  snapshot_time: string
  changed_at: string
}

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const db = createAdminClient()
  const now = new Date().toISOString()
  const errors: string[] = []

  // One-time cleanup: delete bad Pinnacle prop data where line_value > 100
  // (game totals that leaked through before the matchupId filter fix)
  await db
    .from('prop_odds')
    .delete()
    .gt('line_value', 100)

  let kambiResults: KambiPropResult[] = []
  let pinnacleResults: PinnaclePropResult[] = []

  // 1. Scrape both sources in parallel
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000) // 4 min safety

  try {
    const [kambi, pinnacle] = await Promise.allSettled([
      scrapeKambiProps(controller.signal),
      scrapePinnacleProps(controller.signal),
    ])

    if (kambi.status === 'fulfilled') {
      kambiResults = kambi.value
      if (kambiResults.length === 0) errors.push('Kambi: scrape succeeded but returned 0 events')
    } else {
      errors.push(`Kambi scrape failed: ${String(kambi.reason)}`)
    }

    if (pinnacle.status === 'fulfilled') {
      pinnacleResults = pinnacle.value
      if (pinnacleResults.length === 0) errors.push('Pinnacle: scrape succeeded but returned 0 events')
    } else {
      errors.push(`Pinnacle scrape failed: ${String(pinnacle.reason)}`)
    }
  } finally {
    clearTimeout(timeout)
  }

  // 2. Build event-matching lookup: canonical key → DB event UUID
  //    Fetch all upcoming events from DB
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() // 2hr in past (for in-progress)
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, league_id, league:leagues(slug)')
    .gt('start_time', cutoff)

  if (!dbEvents || dbEvents.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'No upcoming events in DB to match props against',
      errors,
      elapsed: Date.now() - startTime,
    })
  }

  // Parse event titles to build a team-name matching index
  // Title format: "Team A vs Team B" or "Team A @ Team B"
  const eventByKey = new Map<string, string>() // canonical key fragment → event UUID
  const eventByTeams = new Map<string, string>() // "home|away" normalized → event UUID

  for (const ev of dbEvents as any[]) {
    const leagueSlug = ev.league?.slug ?? ''
    const date = new Date(ev.start_time).toISOString().slice(0, 10)

    // Parse title: "Away vs Home" or "Away @ Home"
    const parts = ev.title.split(/\s+(?:vs\.?|@)\s+/i)
    if (parts.length === 2) {
      const away = parts[0].toLowerCase().trim()
      const home = parts[1].toLowerCase().trim()
      const key = `${leagueSlug}:${date}:${home}:${away}`
      eventByKey.set(key, ev.id)
      // Also store reverse order for flexible matching
      eventByKey.set(`${leagueSlug}:${date}:${away}:${home}`, ev.id)
      // Team-name index for fuzzy matching
      eventByTeams.set(`${leagueSlug}:${date}:${normalizeTeamForMatch(home)}:${normalizeTeamForMatch(away)}`, ev.id)
      eventByTeams.set(`${leagueSlug}:${date}:${normalizeTeamForMatch(away)}:${normalizeTeamForMatch(home)}`, ev.id)
    }
  }

  // 3. Resolve source IDs for Kambi and Pinnacle
  const { data: sources } = await db
    .from('market_sources')
    .select('id, slug')
    .in('slug', ['betrivers', 'pinnacle'])

  const sourceMap = new Map<string, string>()
  for (const s of sources ?? []) {
    sourceMap.set(s.slug, s.id)
  }

  const kambiSourceId = sourceMap.get('betrivers')
  const pinnacleSourceId = sourceMap.get('pinnacle')

  // 4. Transform scraped props into DB rows
  const propRows: PropRow[] = []

  // Process Kambi results
  if (kambiSourceId) {
    for (const result of kambiResults) {
      const leagueSlug = KAMBI_PATH_TO_LEAGUE[result.event.leaguePath] ?? ''
      const date = new Date(result.event.start).toISOString().slice(0, 10)
      const home = result.event.homeName.toLowerCase().trim()
      const away = result.event.awayName.toLowerCase().trim()

      // Try exact canonical key match
      let eventId = eventByKey.get(`${leagueSlug}:${date}:${home}:${away}`)
        ?? eventByKey.get(`${leagueSlug}:${date}:${away}:${home}`)
      // Try normalized team name match
      if (!eventId) {
        eventId = eventByTeams.get(`${leagueSlug}:${date}:${normalizeTeamForMatch(home)}:${normalizeTeamForMatch(away)}`)
          ?? eventByTeams.get(`${leagueSlug}:${date}:${normalizeTeamForMatch(away)}:${normalizeTeamForMatch(home)}`)
      }
      if (!eventId) continue

      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, kambiSourceId, prop, now))
      }
    }
  }

  // Process Pinnacle results
  if (pinnacleSourceId) {
    for (const result of pinnacleResults) {
      const leagueSlug = PINNACLE_LEAGUE_TO_SLUG[result.parentEvent.leagueName] ?? ''
      const date = new Date(result.parentEvent.startTime).toISOString().slice(0, 10)
      const home = result.parentEvent.homeName.toLowerCase().trim()
      const away = result.parentEvent.awayName.toLowerCase().trim()

      let eventId = eventByKey.get(`${leagueSlug}:${date}:${home}:${away}`)
        ?? eventByKey.get(`${leagueSlug}:${date}:${away}:${home}`)
      if (!eventId) {
        eventId = eventByTeams.get(`${leagueSlug}:${date}:${normalizeTeamForMatch(home)}:${normalizeTeamForMatch(away)}`)
          ?? eventByTeams.get(`${leagueSlug}:${date}:${normalizeTeamForMatch(away)}:${normalizeTeamForMatch(home)}`)
      }
      if (!eventId) continue

      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, pinnacleSourceId, prop, now))
      }
    }
  }

  // Dedup propRows: if the same (event, source, category, player, line) appears
  // multiple times, keep only the last one. This prevents "ON CONFLICT DO UPDATE
  // command cannot affect row a second time" errors in batch upserts.
  const dedupMap = new Map<string, PropRow>()
  for (const row of propRows) {
    const key = propKey(row.event_id, row.source_id, row.prop_category, row.player_name, row.line_value)
    dedupMap.set(key, row)
  }
  const dedupedRows = [...dedupMap.values()]

  if (dedupedRows.length === 0) {
    return NextResponse.json({
      ok: true,
      message: 'No props matched to DB events',
      kambiEvents: kambiResults.length,
      pinnacleEvents: pinnacleResults.length,
      dbEvents: dbEvents.length,
      errors,
      elapsed: Date.now() - startTime,
    })
  }

  // 5. Fetch existing hashes for change detection
  const eventIds = [...new Set(dedupedRows.map(r => r.event_id))]
  const { data: existingProps } = await db
    .from('prop_odds')
    .select('event_id, source_id, prop_category, player_name, line_value, odds_hash')
    .in('event_id', eventIds)

  const existingHashMap = new Map<string, string>()
  for (const ep of existingProps ?? []) {
    const key = propKey(ep.event_id, ep.source_id, ep.prop_category, ep.player_name, ep.line_value)
    existingHashMap.set(key, ep.odds_hash)
  }

  // 6. Partition into changed and unchanged
  const changed: PropRow[] = []
  const unchanged: PropRow[] = []

  for (const row of dedupedRows) {
    const key = propKey(row.event_id, row.source_id, row.prop_category, row.player_name, row.line_value)
    const existingHash = existingHashMap.get(key)

    if (existingHash === row.odds_hash) {
      unchanged.push(row)
    } else {
      changed.push(row)
    }
  }

  // 7. Upsert changed rows into prop_odds
  let upsertErrors = 0
  if (changed.length > 0) {
    // Batch upsert in chunks of 500
    const CHUNK = 500
    for (let i = 0; i < changed.length; i += CHUNK) {
      const chunk = changed.slice(i, i + CHUNK)
      const { error } = await db
        .from('prop_odds')
        .upsert(chunk, {
          onConflict: 'event_id,source_id,prop_category,player_name,line_value',
        })
      if (error) {
        upsertErrors++
        errors.push(`prop_odds upsert error (batch ${Math.floor(i/CHUNK)}): ${error.message}`)
      }
    }
  }

  // 8. Update snapshot_time for unchanged rows (they were still fetched)
  if (unchanged.length > 0) {
    // Bulk update snapshot_time for unchanged rows
    const CHUNK = 500
    for (let i = 0; i < unchanged.length; i += CHUNK) {
      const chunk = unchanged.slice(i, i + CHUNK)
      const keys = chunk.map(r => propKey(r.event_id, r.source_id, r.prop_category, r.player_name, r.line_value))
      // For unchanged, just update snapshot_time via individual updates grouped by event+source
      // This is a tradeoff: simpler than a complex WHERE clause
      const eventSourcePairs = new Set(chunk.map(r => `${r.event_id}|${r.source_id}`))
      for (const pair of eventSourcePairs) {
        const [eid, sid] = pair.split('|')
        await db
          .from('prop_odds')
          .update({ snapshot_time: now })
          .eq('event_id', eid)
          .eq('source_id', sid)
      }
    }
  }

  // 9. Write changed rows to prop_snapshots (history log)
  if (changed.length > 0) {
    const snapshots = changed.map(r => ({
      event_id: r.event_id,
      source_id: r.source_id,
      prop_category: r.prop_category,
      player_name: r.player_name,
      line_value: r.line_value,
      over_price: r.over_price,
      under_price: r.under_price,
      yes_price: r.yes_price,
      no_price: r.no_price,
      over_implied_prob: r.over_implied_prob,
      under_implied_prob: r.under_implied_prob,
      odds_hash: r.odds_hash,
      snapshot_time: now,
    }))

    const CHUNK = 500
    for (let i = 0; i < snapshots.length; i += CHUNK) {
      const { error } = await db
        .from('prop_snapshots')
        .insert(snapshots.slice(i, i + CHUNK))
      if (error) errors.push(`prop_snapshots insert error: ${error.message}`)
    }
  }

  const elapsed = Date.now() - startTime
  return NextResponse.json({
    ok: true,
    kambiEvents: kambiResults.length,
    kambiProps: kambiResults.reduce((s, r) => s + r.props.length, 0),
    pinnacleEvents: pinnacleResults.length,
    pinnacleProps: pinnacleResults.reduce((s, r) => s + r.props.length, 0),
    matchedToDb: propRows.length,
    deduped: dedupedRows.length,
    changed: changed.length,
    unchanged: unchanged.length,
    upsertErrors,
    errors: errors.length > 0 ? errors : undefined,
    elapsed,
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildPropRow(
  eventId: string,
  sourceId: string,
  prop: NormalizedProp,
  now: string,
): PropRow {
  const oddsHash = computePropOddsHash(
    prop.overPrice, prop.underPrice, prop.yesPrice, prop.noPrice,
  )
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
    odds_hash: oddsHash,
    snapshot_time: now,
    changed_at: now,
  }
}

function propKey(
  eventId: string,
  sourceId: string,
  category: string,
  playerName: string,
  lineValue: number | null,
): string {
  return `${eventId}|${sourceId}|${category}|${playerName}|${lineValue ?? 'null'}`
}

function normalizeTeamForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
