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
import { scrapeAllKambiOperators, type KambiPropResult, type KambiGameMarket, type KambiOperatorResults } from '@/lib/pipelines/adapters/kambi-props'
import { scrapePinnacleProps, type PinnaclePropResult } from '@/lib/pipelines/adapters/pinnacle-props'
import { scrapeDraftKings, type DKResult } from '@/lib/pipelines/adapters/draftkings-props'
import { scrapeFanDuel, type FDResult } from '@/lib/pipelines/adapters/fanduel-props'
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

  // Cleanup: delete events with parenthetical team names (FanDuel TBD/pitcher duplicates)
  await db
    .from('events')
    .delete()
    .like('title', '%(TBD)%')
  await db
    .from('events')
    .delete()
    .like('external_id', 'fd:%')
    .filter('title', 'ilike', '%(%')


  let kambiOperatorResults: KambiOperatorResults[] = []
  let pinnacleResults: PinnaclePropResult[] = []
  let dkResults: DKResult[] = []
  let fdResults: FDResult[] = []

  // 1. Scrape all sources in parallel
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000) // 4 min safety

  try {
    const [kambi, dk, fd] = await Promise.allSettled([
      scrapeAllKambiOperators(controller.signal),
      scrapeDraftKings(controller.signal),
      scrapeFanDuel(controller.signal),
    ])

    if (kambi.status === 'fulfilled') {
      kambiOperatorResults = kambi.value
      const totalEvents = kambiOperatorResults.reduce((s, o) => s + o.results.length, 0)
      if (totalEvents === 0) errors.push('Kambi: scrape succeeded but returned 0 events')
    } else {
      errors.push(`Kambi scrape failed: ${String(kambi.reason)}`)
    }

    if (dk.status === 'fulfilled') {
      dkResults = dk.value
      if (dkResults.length === 0) errors.push('DraftKings: scrape succeeded but returned 0 events')
    } else {
      errors.push(`DraftKings scrape failed: ${String(dk.reason)}`)
    }

    if (fd.status === 'fulfilled') {
      fdResults = fd.value
      if (fdResults.length === 0) errors.push('FanDuel: scrape succeeded but returned 0 events')
    } else {
      errors.push(`FanDuel scrape failed: ${String(fd.reason)}`)
    }
  } finally {
    clearTimeout(timeout)
  }

  // 2. Build event-matching lookup + auto-create missing events
  //    Fetch all upcoming events from DB
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, league_id, league:leagues(slug)')
    .gt('start_time', cutoff)

  // Fetch league slug→id mapping for event creation
  const { data: leaguesRaw } = await db
    .from('leagues')
    .select('id, slug')
  const leagueIdBySlug = new Map<string, string>()
  for (const l of leaguesRaw ?? []) leagueIdBySlug.set(l.slug, l.id)

  // Build lookup from existing events using ORDER-INDEPENDENT keys.
  // Key format: "league:date:sortedTeamA:sortedTeamB" — same key regardless
  // of which team is listed first in the title.
  const eventByKey = new Map<string, string>()

  function makeMatchKey(leagueSlug: string, date: string, teamA: string, teamB: string): string {
    const a = normalizeTeamForMatch(teamA)
    const b = normalizeTeamForMatch(teamB)
    // Sort alphabetically so order doesn't matter
    const sorted = [a, b].sort()
    return `${leagueSlug}:${date}:${sorted[0]}:${sorted[1]}`
  }

  // Also index by team nickname (last word) for fuzzy matching
  function makeNicknameKey(leagueSlug: string, date: string, teamA: string, teamB: string): string {
    const nickA = normalizeTeamForMatch(teamA).split(' ').pop() ?? ''
    const nickB = normalizeTeamForMatch(teamB).split(' ').pop() ?? ''
    const sorted = [nickA, nickB].sort()
    return `nick:${leagueSlug}:${date}:${sorted[0]}:${sorted[1]}`
  }

  for (const ev of (dbEvents ?? []) as any[]) {
    const leagueSlug = ev.league?.slug ?? ''
    const date = new Date(ev.start_time).toISOString().slice(0, 10)
    const parts = ev.title.split(/\s+(?:vs\.?|@)\s+/i)
    if (parts.length === 2) {
      const teamA = parts[0].trim()
      const teamB = parts[1].trim()
      eventByKey.set(makeMatchKey(leagueSlug, date, teamA, teamB), ev.id)
      eventByKey.set(makeNicknameKey(leagueSlug, date, teamA, teamB), ev.id)
    }
  }

  /** Find existing event ID for a game */
  function findEvent(leagueSlug: string, startTime: string, teamA: string, teamB: string): string | undefined {
    const date = new Date(startTime).toISOString().slice(0, 10)
    return eventByKey.get(makeMatchKey(leagueSlug, date, teamA, teamB))
      ?? eventByKey.get(makeNicknameKey(leagueSlug, date, teamA, teamB))
  }

  /** Register a new event in the lookup */
  function registerEvent(leagueSlug: string, startTime: string, teamA: string, teamB: string, eventId: string) {
    const date = new Date(startTime).toISOString().slice(0, 10)
    eventByKey.set(makeMatchKey(leagueSlug, date, teamA, teamB), eventId)
    eventByKey.set(makeNicknameKey(leagueSlug, date, teamA, teamB), eventId)
  }

  // Collect all Kambi events that need DB event creation
  let eventsCreated = 0
  const firstOperator = kambiOperatorResults[0]
  if (firstOperator) {
    for (const result of firstOperator.results) {
      const leagueSlug = KAMBI_PATH_TO_LEAGUE[result.event.leaguePath] ?? ''
      const leagueId = leagueIdBySlug.get(leagueSlug)
      if (!leagueId) continue

      const home = result.event.homeName
      const away = result.event.awayName

      if (findEvent(leagueSlug, result.event.start, home, away)) continue

      const title = `${away} vs ${home}`
      const { data: newEvent, error: evErr } = await db
        .from('events')
        .insert({ title, start_time: result.event.start, status: 'scheduled', league_id: leagueId, external_id: `kambi:${result.event.eventId}` })
        .select('id').single()

      if (newEvent) {
        eventsCreated++
        registerEvent(leagueSlug, result.event.start, home, away, newEvent.id)
      } else if (evErr) {
        const { data: existingEv } = await db.from('events').select('id').eq('external_id', `kambi:${result.event.eventId}`).single()
        if (existingEv) registerEvent(leagueSlug, result.event.start, home, away, existingEv.id)
      }
    }
  }

  // Auto-create events from DraftKings too
  for (const result of dkResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue

    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: `dk:${result.event.eventId}` })
      .select('id').single()

    if (newEvent) {
      eventsCreated++
      registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id)
    }
  }

  // 3. Resolve source IDs for all operators
  const allSlugs = [
    ...kambiOperatorResults.map(o => o.operator.sourceSlug),
    'pinnacle',
    'draftkings',
    'fanduel',
  ]
  const { data: sources } = await db
    .from('market_sources')
    .select('id, slug')
    .in('slug', allSlugs)

  const sourceMap = new Map<string, string>()
  for (const s of sources ?? []) {
    sourceMap.set(s.slug, s.id)
  }

  // Auto-create missing sources for new Kambi operators
  for (const op of kambiOperatorResults) {
    if (!sourceMap.has(op.operator.sourceSlug)) {
      const { data: newSource } = await db
        .from('market_sources')
        .insert({
          name: op.operator.displayName,
          slug: op.operator.sourceSlug,
          source_type: 'sportsbook',
          is_active: true,
        })
        .select('id')
        .single()
      if (newSource) sourceMap.set(op.operator.sourceSlug, newSource.id)
    }
  }

  const pinnacleSourceId = sourceMap.get('pinnacle')

  // 4. Transform scraped props into DB rows
  const propRows: PropRow[] = []

  // Process Kambi results — one pass per operator
  for (const { operator, results: kambiResults } of kambiOperatorResults) {
    const sourceId = sourceMap.get(operator.sourceSlug)
    if (!sourceId) continue

    for (const result of kambiResults) {
      const leagueSlug = KAMBI_PATH_TO_LEAGUE[result.event.leaguePath] ?? ''
      const eventId = findEvent(leagueSlug, result.event.start, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, sourceId, prop, now))
      }
    }
  }

  // Process Pinnacle results
  if (pinnacleSourceId) {
    for (const result of pinnacleResults) {
      const leagueSlug = PINNACLE_LEAGUE_TO_SLUG[result.parentEvent.leagueName] ?? ''
      const eventId = findEvent(leagueSlug, result.parentEvent.startTime, result.parentEvent.homeName, result.parentEvent.awayName)
      if (!eventId) continue

      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, pinnacleSourceId, prop, now))
      }
    }
  }

  // 4b. Write Kambi game-level markets (ML, spread, total) into current_market_odds.
  // All Kambi operators write here so Markets page shows multiple sources.
  const gameMarketRows: any[] = []
  for (const { operator, results: kambiResults } of kambiOperatorResults) {
    const sourceId = sourceMap.get(operator.sourceSlug)
    if (!sourceId) continue

    for (const result of kambiResults) {
      const leagueSlug = KAMBI_PATH_TO_LEAGUE[result.event.leaguePath] ?? ''
      const eventId = findEvent(leagueSlug, result.event.start, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
          .map(v => v ?? '').join('|')
        const homeProb = gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null
        const awayProb = gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null
        // line_value: the spread or total number, null for moneyline
        const lineValue = gm.marketType === 'spread' ? gm.spreadValue
          : gm.marketType === 'total' ? gm.totalValue
          : null
        gameMarketRows.push({
          event_id: eventId,
          source_id: sourceId,
          market_type: gm.marketType,
          line_value: lineValue,
          odds_hash: oddsHash,
          home_price: gm.homePrice,
          away_price: gm.awayPrice,
          draw_price: gm.drawPrice,
          spread_value: gm.spreadValue,
          total_value: gm.totalValue,
          over_price: gm.overPrice,
          under_price: gm.underPrice,
          home_implied_prob: homeProb,
          away_implied_prob: awayProb,
          movement_direction: 'flat',
          snapshot_time: now,
          changed_at: now,
        })
      }
    }
  }

  // Process DraftKings game markets
  const dkSourceId = sourceMap.get('draftkings')
  if (dkSourceId) {
    for (const result of dkResults) {
      const leagueSlug = result.event.leagueSlug
      const eventId = findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
          .map(v => v ?? '').join('|')
        const lineValue = gm.marketType === 'spread' ? gm.spreadValue
          : gm.marketType === 'total' ? gm.totalValue : null
        gameMarketRows.push({
          event_id: eventId,
          source_id: dkSourceId,
          market_type: gm.marketType,
          line_value: lineValue,
          odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
    }
  }

  // Auto-create DraftKings source if missing
  if (!dkSourceId && dkResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'DraftKings', slug: 'draftkings', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) sourceMap.set('draftkings', newSource.id)
  }

  // Process FanDuel events + game markets
  // Auto-create FanDuel source if missing
  let fdSourceId = sourceMap.get('fanduel')
  if (!fdSourceId && fdResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'FanDuel', slug: 'fanduel', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) { fdSourceId = newSource.id; sourceMap.set('fanduel', newSource.id) }
  }

  // Auto-create FanDuel events
  for (const result of fdResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue

    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: `fd:${result.event.eventId}` })
      .select('id').single()

    if (newEvent) {
      eventsCreated++
      registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id)
    }
  }

  // FanDuel game markets
  if (fdSourceId) {
    for (const result of fdResults) {
      const leagueSlug = result.event.leagueSlug
      const eventId = findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
          .map(v => v ?? '').join('|')
        const lineValue = gm.marketType === 'spread' ? gm.spreadValue
          : gm.marketType === 'total' ? gm.totalValue : null
        gameMarketRows.push({
          event_id: eventId, source_id: fdSourceId, market_type: gm.marketType,
          line_value: lineValue, odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
    }
  }

  // Dedup game market rows before upsert
  const gmDedupMap = new Map<string, any>()
  for (const row of gameMarketRows) {
    const key = `${row.event_id}|${row.source_id}|${row.market_type}|${row.line_value ?? 'null'}`
    gmDedupMap.set(key, row)
  }
  const dedupedGameRows = [...gmDedupMap.values()]

  let gameMarketsUpserted = 0
  if (dedupedGameRows.length > 0) {
    const CHUNK = 500
    for (let i = 0; i < dedupedGameRows.length; i += CHUNK) {
      const { error } = await db
        .from('current_market_odds')
        .upsert(dedupedGameRows.slice(i, i + CHUNK), {
          onConflict: 'event_id,source_id,market_type,line_value',
        })
      if (error) errors.push(`current_market_odds upsert: ${error.message}`)
      else gameMarketsUpserted += dedupedGameRows.slice(i, i + CHUNK).length
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
      kambiOperators: kambiOperatorResults.length,
      pinnacleEvents: pinnacleResults.length,
      dbEvents: (dbEvents?.length ?? 0) + eventsCreated,
      eventsCreated,
      gameMarketsUpserted,
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
    eventsCreated,
    kambiOperators: kambiOperatorResults.map(o => ({
      slug: o.operator.sourceSlug,
      events: o.results.length,
      props: o.results.reduce((s, r) => s + r.props.length, 0),
      gameMarkets: o.results.reduce((s, r) => s + r.gameMarkets.length, 0),
    })),
    draftkings: { events: dkResults.length, gameMarkets: dkResults.reduce((s, r) => s + r.gameMarkets.length, 0) },
    fanduel: { events: fdResults.length, gameMarkets: fdResults.reduce((s, r) => s + r.gameMarkets.length, 0) },
    gameMarketsUpserted,
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

const TEAM_CITY_ALIASES: Record<string, string> = {
  'la ': 'los angeles ', 'ny ': 'new york ', 'gs ': 'golden state ',
  'sa ': 'san antonio ', 'no ': 'new orleans ', 'okc ': 'oklahoma city ',
  'tb ': 'tampa bay ', 'kc ': 'kansas city ', 'gb ': 'green bay ',
  'ne ': 'new england ',
}

function normalizeTeamForMatch(name: string): string {
  let n = name
    .toLowerCase()
    // Strip parenthetical content: "Houston Astros (TBD)" → "Houston Astros"
    // Also handles pitcher names: "Houston Astros (J.Verlander)" → "Houston Astros"
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [abbr, full] of Object.entries(TEAM_CITY_ALIASES)) {
    if (n.startsWith(abbr)) { n = full + n.slice(abbr.length); break }
  }
  return n
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
