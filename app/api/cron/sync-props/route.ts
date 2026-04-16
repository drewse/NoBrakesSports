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
import { sendArbAlert, sendEvAlert } from '@/lib/alerts/discord'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeAllKambiOperators, type KambiPropResult, type KambiGameMarket, type KambiOperatorResults } from '@/lib/pipelines/adapters/kambi-props'
import { scrapePinnacleProps, type PinnaclePropResult } from '@/lib/pipelines/adapters/pinnacle-props'
import { scrapeDraftKings, type DKResult } from '@/lib/pipelines/adapters/draftkings-props'
import { scrapeFanDuel, type FDResult } from '@/lib/pipelines/adapters/fanduel-props'
import { scrapeBetway, type BWResult } from '@/lib/pipelines/adapters/betway-props'
import { scrapeBetMGM, type MGMResult } from '@/lib/pipelines/adapters/betmgm-props'
import { scrapeBwin, type BWINResult } from '@/lib/pipelines/adapters/bwin-props'
import { scrapePartypoker, type PPResult } from '@/lib/pipelines/adapters/partypoker-props'
import { scrapePointsBet, type PBResult } from '@/lib/pipelines/adapters/pointsbet-props'
import { computePropOddsHash, americanToImpliedProb } from '@/lib/pipelines/prop-normalizer'
import { canonicalEventKey } from '@/lib/pipelines/normalize'

/** Generate the same external_id as the Pinnacle pipeline adapter uses */
function makeExternalId(leagueSlug: string, startTime: string, homeTeam: string, awayTeam: string): string {
  return canonicalEventKey({ leagueSlug, startTime, homeTeam, awayTeam })
}
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
  let bwResults: BWResult[] = []
  let mgmResults: MGMResult[] = []
  let bwinResults: BWINResult[] = []
  let ppResults: PPResult[] = []
  let pbResults: PBResult[] = []

  // 1. Scrape all sources in parallel
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000) // 4 min safety

  try {
    const [kambi, dk, fd, bw, mgm, bwinRes, ppRes, pbRes] = await Promise.allSettled([
      scrapeAllKambiOperators(controller.signal),
      scrapeDraftKings(controller.signal),
      scrapeFanDuel(controller.signal),
      scrapeBetway(controller.signal),
      scrapeBetMGM(controller.signal),
      scrapeBwin(controller.signal),
      scrapePartypoker(controller.signal),
      scrapePointsBet(controller.signal),
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

    if (bw.status === 'fulfilled') {
      bwResults = bw.value
      if (bwResults.length === 0) errors.push('Betway: scrape succeeded but returned 0 events')
    } else {
      errors.push(`Betway scrape failed: ${String(bw.reason)}`)
    }

    if (mgm.status === 'fulfilled') {
      mgmResults = mgm.value
      if (mgmResults.length === 0) errors.push('BetMGM: scrape succeeded but returned 0 events')
    } else {
      errors.push(`BetMGM scrape failed: ${String(mgm.reason)}`)
    }

    if (bwinRes.status === 'fulfilled') {
      bwinResults = bwinRes.value
      if (bwinResults.length === 0) errors.push('bwin: scrape succeeded but returned 0 events')
    } else {
      errors.push(`bwin scrape failed: ${String(bwinRes.reason)}`)
    }

    if (ppRes.status === 'fulfilled') {
      ppResults = ppRes.value
      if (ppResults.length === 0) errors.push('partypoker: scrape succeeded but returned 0 events')
    } else {
      errors.push(`partypoker scrape failed: ${String(ppRes.reason)}`)
    }

    if (pbRes.status === 'fulfilled') {
      pbResults = pbRes.value
      // PointsBet may silently return 0 if Cloudflare blocks — not an error
      if (pbResults.length > 0) console.log(`[PointsBet] ${pbResults.length} events scraped`)
    } else {
      errors.push(`PointsBet scrape failed: ${String(pbRes.reason)}`)
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
        .insert({ title, start_time: result.event.start, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(leagueSlug, result.event.start, home, away) })
        .select('id').single()

      if (newEvent) {
        eventsCreated++
        registerEvent(leagueSlug, result.event.start, home, away, newEvent.id)
      } else if (evErr) {
        const { data: existingEv } = await db.from('events').select('id').eq('external_id', makeExternalId(leagueSlug, result.event.start, home, away)).single()
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
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
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
    'betway',
    'betmgm',
    'bwin',
    'partypoker',
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

  // Process FanDuel player props
  const fdSourceIdForProps = sourceMap.get('fanduel')
  if (fdSourceIdForProps) {
    for (const result of fdResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, fdSourceIdForProps, prop, now))
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
        gameMarketRows.push({
          event_id: eventId,
          source_id: sourceId,
          market_type: gm.marketType,
          line_value: 0,
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

  // Process DraftKings game markets + player props
  const dkSourceId = sourceMap.get('draftkings')
  if (dkSourceId) {
    for (const result of dkResults) {
      const leagueSlug = result.event.leagueSlug
      const eventId = findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
          .map(v => v ?? '').join('|')
        gameMarketRows.push({
          event_id: eventId,
          source_id: dkSourceId,
          market_type: gm.marketType,
          line_value: 0,
          odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
      // DraftKings player props
      for (const prop of result.props ?? []) {
        propRows.push(buildPropRow(eventId, dkSourceId, prop, now))
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
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
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
        gameMarketRows.push({
          event_id: eventId, source_id: fdSourceId, market_type: gm.marketType,
          line_value: 0, odds_hash: oddsHash,
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

  // Process Betway events + game markets
  let bwSourceId = sourceMap.get('betway')
  if (!bwSourceId && bwResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'Betway', slug: 'betway', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) { bwSourceId = newSource.id; sourceMap.set('betway', newSource.id) }
  }

  // Auto-create Betway events
  for (const result of bwResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue

    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) {
      eventsCreated++
      registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id)
    }
  }

  // Betway game markets + player props
  if (bwSourceId) {
    for (const result of bwResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice]
          .map(v => v ?? '').join('|')
        gameMarketRows.push({
          event_id: eventId, source_id: bwSourceId, market_type: gm.marketType,
          line_value: 0, odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
      // Betway player props
      for (const prop of result.props ?? []) {
        propRows.push(buildPropRow(eventId, bwSourceId, prop, now))
      }
    }
  }

  // Process BetMGM events + game markets
  let mgmSourceId = sourceMap.get('betmgm')
  if (!mgmSourceId && mgmResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'BetMGM', slug: 'betmgm', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) { mgmSourceId = newSource.id; sourceMap.set('betmgm', newSource.id) }
  }

  for (const result of mgmResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue
    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id) }
  }

  if (mgmSourceId) {
    for (const result of mgmResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice].map(v => v ?? '').join('|')
        gameMarketRows.push({
          event_id: eventId, source_id: mgmSourceId, market_type: gm.marketType,
          line_value: 0, odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
      // BetMGM player props
      for (const prop of result.props ?? []) {
        propRows.push(buildPropRow(eventId, mgmSourceId, prop, now))
      }
    }
  }

  // Process bwin events + game markets (same Entain CDS as BetMGM)
  let bwinSourceId = sourceMap.get('bwin')
  if (!bwinSourceId && bwinResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'bwin', slug: 'bwin', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) { bwinSourceId = newSource.id; sourceMap.set('bwin', newSource.id) }
  }

  for (const result of bwinResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue
    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id) }
  }

  if (bwinSourceId) {
    for (const result of bwinResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice].map(v => v ?? '').join('|')
        gameMarketRows.push({
          event_id: eventId, source_id: bwinSourceId, market_type: gm.marketType,
          line_value: 0, odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
      for (const prop of result.props ?? []) {
        propRows.push(buildPropRow(eventId, bwinSourceId, prop, now))
      }
    }
  }

  // Process partypoker events + game markets
  let ppSourceId = sourceMap.get('partypoker')
  if (!ppSourceId && ppResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'partypoker', slug: 'partypoker', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) { ppSourceId = newSource.id; sourceMap.set('partypoker', newSource.id) }
  }

  for (const result of ppResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue
    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id) }
  }

  if (ppSourceId) {
    for (const result of ppResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice].map(v => v ?? '').join('|')
        gameMarketRows.push({
          event_id: eventId, source_id: ppSourceId, market_type: gm.marketType,
          line_value: 0, odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
      for (const prop of result.props ?? []) {
        propRows.push(buildPropRow(eventId, ppSourceId, prop, now))
      }
    }
  }

  // Process PointsBet events + game markets + props
  let pbSourceId = sourceMap.get('pointsbet_on')
  if (!pbSourceId && pbResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'PointsBet', slug: 'pointsbet_on', source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (newSource) { pbSourceId = newSource.id; sourceMap.set('pointsbet_on', newSource.id) }
  }

  for (const result of pbResults) {
    const leagueSlug = result.event.leagueSlug
    const leagueId = leagueIdBySlug.get(leagueSlug)
    if (!leagueId) continue
    if (findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)) continue
    const title = `${result.event.awayName} vs ${result.event.homeName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id) }
  }

  if (pbSourceId) {
    for (const result of pbResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const gm of result.gameMarkets) {
        const oddsHash = [gm.homePrice, gm.awayPrice, gm.drawPrice, gm.spreadValue, gm.totalValue, gm.overPrice, gm.underPrice].map(v => v ?? '').join('|')
        gameMarketRows.push({
          event_id: eventId, source_id: pbSourceId, market_type: gm.marketType,
          line_value: 0, odds_hash: oddsHash,
          home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
          spread_value: gm.spreadValue, total_value: gm.totalValue,
          over_price: gm.overPrice, under_price: gm.underPrice,
          home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
          away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
          movement_direction: 'flat', snapshot_time: now, changed_at: now,
        })
      }
      for (const prop of result.props ?? []) {
        propRows.push(buildPropRow(eventId, pbSourceId, prop, now))
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

  // Update last_checked_at / last_success_at on data_pipelines for sources that synced.
  // This keeps the Data Pipelines admin page timestamps accurate.
  const syncedSlugs = new Set<string>()
  for (const op of kambiOperatorResults) {
    if (op.results.length > 0) syncedSlugs.add(op.operator.sourceSlug)
  }
  if (dkResults.length > 0) syncedSlugs.add('draftkings')
  if (fdResults.length > 0) syncedSlugs.add('fanduel')
  if (bwResults.length > 0) syncedSlugs.add('betway')
  if (mgmResults.length > 0) syncedSlugs.add('betmgm')
  if (bwinResults.length > 0) syncedSlugs.add('bwin')
  if (ppResults.length > 0) syncedSlugs.add('partypoker')
  if (pbResults.length > 0) syncedSlugs.add('pointsbet_on')

  if (syncedSlugs.size > 0) {
    await db
      .from('data_pipelines')
      .update({ last_checked_at: now, last_success_at: now, status: 'healthy', consecutive_failures: 0, circuit_open_at: null })
      .in('slug', [...syncedSlugs])
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

  // ── Discord Alerts: detect arbs and +EV from freshly upserted data ──────
  let alertsSent = 0
  try {
    // Build event title lookup
    const eventTitles = new Map<string, string>()
    const { data: eventRows } = await db
      .from('events')
      .select('id, title')
      .gt('start_time', new Date().toISOString())
      .limit(500)
    for (const e of eventRows ?? []) eventTitles.set(e.id, e.title)

    // Pinnacle source ID for +EV detection
    const pinSourceId = sourceMap.get('pinnacle')

    // Group ML rows by event
    const mlByEvent = new Map<string, { source: string; sourceId: string; home: number; away: number }[]>()
    for (const row of dedupedGameRows) {
      if (row.market_type !== 'moneyline' || !row.home_price || !row.away_price) continue
      const slug = [...sourceMap.entries()].find(([, id]) => id === row.source_id)?.[0] ?? '?'
      if (!mlByEvent.has(row.event_id)) mlByEvent.set(row.event_id, [])
      mlByEvent.get(row.event_id)!.push({ source: slug, sourceId: row.source_id, home: row.home_price, away: row.away_price })
    }

    const toImplied = (odds: number) => odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100)

    for (const [eventId, sources] of mlByEvent) {
      if (sources.length < 2) continue
      const title = eventTitles.get(eventId) ?? eventId.slice(0, 12)

      // ── Arb check ──
      const bestHome = sources.reduce((best, s) => s.home > best.home ? s : best)
      const bestAway = sources.reduce((best, s) => s.away > best.away ? s : best)
      if (bestHome.source !== bestAway.source) {
        const combined = toImplied(bestHome.home) + toImplied(bestAway.away)
        if (combined < 1.0) {
          const profitPct = (1 / combined - 1) * 100
          if (profitPct >= 0.5) {
            await sendArbAlert({
              type: 'arb', eventTitle: title, league: '—', market: 'Moneyline',
              sideA: { label: 'Home', price: bestHome.home, source: bestHome.source },
              sideB: { label: 'Away', price: bestAway.away, source: bestAway.source },
              profitPct,
            })
            alertsSent++
          }
        }
      }

      // ── +EV check (Pinnacle reference) ──
      if (pinSourceId) {
        const pin = sources.find(s => s.sourceId === pinSourceId)
        if (pin) {
          const pinHomeProb = toImplied(pin.home)
          const pinAwayProb = toImplied(pin.away)
          const overround = pinHomeProb + pinAwayProb
          // Power devig (simple multiplicative for speed)
          const fairHome = pinHomeProb / overround
          const fairAway = pinAwayProb / overround

          for (const s of sources) {
            if (s.sourceId === pinSourceId) continue // don't compare Pinnacle to itself

            // Check home side
            const homeDecimal = s.home > 0 ? s.home / 100 + 1 : 100 / Math.abs(s.home) + 1
            const homeEv = (fairHome * homeDecimal - 1) * 100
            if (homeEv >= 3) {
              await sendEvAlert({
                type: 'ev', eventTitle: title, league: '—',
                outcomeLabel: `Home ML`,
                bestPrice: s.home, bestSource: s.source,
                evPct: homeEv, fairProb: fairHome,
                kellyPct: Math.max(0, ((homeDecimal - 1) * fairHome - fairAway) / (homeDecimal - 1)) * 25,
              })
              alertsSent++
            }

            // Check away side
            const awayDecimal = s.away > 0 ? s.away / 100 + 1 : 100 / Math.abs(s.away) + 1
            const awayEv = (fairAway * awayDecimal - 1) * 100
            if (awayEv >= 3) {
              await sendEvAlert({
                type: 'ev', eventTitle: title, league: '—',
                outcomeLabel: `Away ML`,
                bestPrice: s.away, bestSource: s.source,
                evPct: awayEv, fairProb: fairAway,
                kellyPct: Math.max(0, ((awayDecimal - 1) * fairAway - fairHome) / (awayDecimal - 1)) * 25,
              })
              alertsSent++
            }
          }
        }
      }

      if (alertsSent >= 5) break // rate limit
    }
  } catch (e) {
    console.error('Alert detection error:', e)
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
    fanduel: { events: fdResults.length, gameMarkets: fdResults.reduce((s, r) => s + r.gameMarkets.length, 0), props: fdResults.reduce((s, r) => s + r.props.length, 0) },
    betway: { events: bwResults.length, gameMarkets: bwResults.reduce((s, r) => s + r.gameMarkets.length, 0) },
    betmgm: { events: mgmResults.length, gameMarkets: mgmResults.reduce((s, r) => s + r.gameMarkets.length, 0) },
    bwin: { events: bwinResults.length, gameMarkets: bwinResults.reduce((s, r) => s + r.gameMarkets.length, 0) },
    partypoker: { events: ppResults.length, gameMarkets: ppResults.reduce((s, r) => s + r.gameMarkets.length, 0) },
    gameMarketsUpserted,
    pinnacleEvents: pinnacleResults.length,
    pinnacleProps: pinnacleResults.reduce((s, r) => s + r.props.length, 0),
    matchedToDb: propRows.length,
    deduped: dedupedRows.length,
    changed: changed.length,
    unchanged: unchanged.length,
    upsertErrors,
    errors: errors.length > 0 ? errors : undefined,
    alertsSent,
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
