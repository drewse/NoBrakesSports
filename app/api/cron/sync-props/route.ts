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
import { scrapeBetway, type BWResult } from '@/lib/pipelines/adapters/betway-props'
import { scrapeBetMGM, type MGMResult } from '@/lib/pipelines/adapters/betmgm-props'
import { scrapeBwin, type BWINResult } from '@/lib/pipelines/adapters/bwin-props'
import { scrapePartypoker, type PPResult } from '@/lib/pipelines/adapters/partypoker-props'
import { scrapePrizePicks, type PrizePicksResult } from '@/lib/pipelines/adapters/prizepicks'
// Underdog is scraped from a separate cron endpoint (/api/cron/sync-underdog)
// to isolate its 16MB payload from sync-props' memory budget.
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
  let prizepicksResults: PrizePicksResult[] = []

  // 1. Scrape all sources in parallel
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 240_000) // 4 min safety

  try {
    // NOTE: PointsBet is now handled by the Railway worker. Skip the HTTP
    // adapter here — it mis-parses PB's current grouped multi-outcome markets
    // and produces garbage player names / stale lines that collide with the
    // worker's writes on the same (source_id, event_id, prop_category, player,
    // line_value) key and cause fake arbs/+EV.
    const [kambi, pin, dk, fd, bw, mgm, bwinRes, ppRes, prizepicksRes] = await Promise.allSettled([
      scrapeAllKambiOperators(controller.signal),
      scrapePinnacleProps(controller.signal),
      scrapeDraftKings(controller.signal),
      scrapeFanDuel(controller.signal),
      scrapeBetway(controller.signal),
      scrapeBetMGM(controller.signal),
      scrapeBwin(controller.signal),
      scrapePartypoker(controller.signal),
      scrapePrizePicks(controller.signal),
    ])

    if (kambi.status === 'fulfilled') {
      kambiOperatorResults = kambi.value
      const totalEvents = kambiOperatorResults.reduce((s, o) => s + o.results.length, 0)
      if (totalEvents === 0) errors.push('Kambi: scrape succeeded but returned 0 events')
    } else {
      errors.push(`Kambi scrape failed: ${String(kambi.reason)}`)
    }

    if (pin.status === 'fulfilled') {
      pinnacleResults = pin.value
      if (pinnacleResults.length === 0) errors.push('Pinnacle: scrape succeeded but returned 0 events')
    } else {
      errors.push(`Pinnacle scrape failed: ${String(pin.reason)}`)
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

    if (prizepicksRes.status === 'fulfilled') {
      prizepicksResults = prizepicksRes.value
      if (prizepicksResults.length === 0) errors.push('prizepicks: scrape succeeded but returned 0 events')
    } else {
      errors.push(`prizepicks scrape failed: ${String(prizepicksRes.reason)}`)
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

  // Track each event's canonical "home" side (parts[0] of title). Every
  // book's home_price column in current_market_odds must refer to the SAME
  // team for an event or else cross-book arbs pair mismatched sides and
  // produce phantom opportunities. Books that disagree on home/away get
  // swapped at write time (see needsSwap helper below).
  const eventHomeSide = new Map<string, string>()

  for (const ev of (dbEvents ?? []) as any[]) {
    const leagueSlug = ev.league?.slug ?? ''
    const date = new Date(ev.start_time).toISOString().slice(0, 10)
    const parts = ev.title.split(/\s+(?:vs\.?|@)\s+/i)
    if (parts.length === 2) {
      const teamA = parts[0].trim()
      const teamB = parts[1].trim()
      eventByKey.set(makeMatchKey(leagueSlug, date, teamA, teamB), ev.id)
      eventByKey.set(makeNicknameKey(leagueSlug, date, teamA, teamB), ev.id)
      eventHomeSide.set(ev.id, teamA)
    }
  }

  /** Returns true when the adapter's homeName is NOT the DB event's canonical
   *  parts[0] home — i.e., the gm.homePrice/awayPrice need to be swapped to
   *  line up with other books' rows for the same event. */
  function needsSwap(eventId: string, adapterHome: string, adapterAway: string): boolean {
    const dbHome = eventHomeSide.get(eventId)
    if (!dbHome) return false
    const n = (s: string) => s.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
    const h = n(adapterHome), a = n(adapterAway), db = n(dbHome)
    // If adapter's home equals canonical home, no swap.
    if (h === db) return false
    // If adapter's away equals canonical home, swap is needed.
    if (a === db) return true
    // Last-word nickname match (e.g. "LA Dodgers" vs "Los Angeles Dodgers")
    const lastWord = (s: string) => s.split(' ').pop() ?? ''
    if (lastWord(h) === lastWord(db)) return false
    if (lastWord(a) === lastWord(db)) return true
    return false
  }

  /** Apply home/away swap to a game market row if the adapter's notion of
   *  home differs from the DB event's canonical parts[0] home. Swapping sides
   *  also flips the spread sign (home favorite becomes home underdog). */
  function orientGM(gm: any, eventId: string, adapterHome: string, adapterAway: string): any {
    if (!needsSwap(eventId, adapterHome, adapterAway)) return gm
    return {
      ...gm,
      homePrice: gm.awayPrice ?? null,
      awayPrice: gm.homePrice ?? null,
      spreadValue: gm.spreadValue != null ? -gm.spreadValue : null,
    }
  }

  /** Find existing event ID for a game */
  function findEvent(leagueSlug: string, startTime: string, teamA: string, teamB: string): string | undefined {
    const date = new Date(startTime).toISOString().slice(0, 10)
    return eventByKey.get(makeMatchKey(leagueSlug, date, teamA, teamB))
      ?? eventByKey.get(makeNicknameKey(leagueSlug, date, teamA, teamB))
  }

  /** Register a new event in the lookup. The `homeName` (physical home team)
   *  is stored as the canonical home anchor so later writers swap if needed. */
  function registerEvent(leagueSlug: string, startTime: string, teamA: string, teamB: string, eventId: string, homeName?: string) {
    const date = new Date(startTime).toISOString().slice(0, 10)
    eventByKey.set(makeMatchKey(leagueSlug, date, teamA, teamB), eventId)
    eventByKey.set(makeNicknameKey(leagueSlug, date, teamA, teamB), eventId)
    if (homeName) eventHomeSide.set(eventId, homeName)
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

    const title = `${result.event.homeName} vs ${result.event.awayName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()

    if (newEvent) {
      eventsCreated++
      registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id, result.event.homeName)
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
    const byLeague: Record<string, { matched: number; unmatchedEvents: number; props: number; badStart: number; noLeagueSlug: number }> = {}
    const unmatchedSamples: string[] = []
    for (const result of pinnacleResults) {
      const leagueSlug = PINNACLE_LEAGUE_TO_SLUG[result.parentEvent.leagueName] ?? ''
      const bucket = (byLeague[leagueSlug || 'UNKNOWN'] ||= { matched: 0, unmatchedEvents: 0, props: 0, badStart: 0, noLeagueSlug: 0 })
      if (!leagueSlug) { bucket.noLeagueSlug++; continue }
      // Guard against Pinnacle specials where startTime is empty/unparseable —
      // findEvent's new Date() would throw and abort the whole loop.
      if (!result.parentEvent.startTime || isNaN(new Date(result.parentEvent.startTime).getTime())) {
        bucket.badStart++
        continue
      }
      const eventId = findEvent(leagueSlug, result.parentEvent.startTime, result.parentEvent.homeName, result.parentEvent.awayName)
      if (!eventId) {
        bucket.unmatchedEvents++
        if (unmatchedSamples.length < 6) {
          unmatchedSamples.push(
            `${leagueSlug} "${result.parentEvent.homeName}" vs "${result.parentEvent.awayName}" @ ${result.parentEvent.startTime}`
          )
        }
        continue
      }
      bucket.matched++
      bucket.props += result.props.length

      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, pinnacleSourceId, prop, now))
      }
    }
    console.log('[pinnacle-props] event-match breakdown', byLeague)
    if (unmatchedSamples.length) {
      console.log('[pinnacle-props] unmatched event samples', unmatchedSamples)
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

  // Process PrizePicks (DFS pick-em) — auto-create source row on first run,
  // then match each game's projections against canonical events. Props
  // carry line_value only; over_price / under_price are NULL by design
  // (PrizePicks doesn't quote per-leg odds — payouts are pick-count based).
  let prizepicksSourceId = sourceMap.get('prizepicks')
  if (!prizepicksSourceId && prizepicksResults.length > 0) {
    const { data: newSource } = await db
      .from('market_sources')
      .insert({ name: 'PrizePicks', slug: 'prizepicks', source_type: 'dfs', is_active: true })
      .select('id')
      .single()
    if (newSource) { prizepicksSourceId = newSource.id; sourceMap.set('prizepicks', newSource.id) }
  }
  if (prizepicksSourceId) {
    let ppMatched = 0
    let ppUnmatched = 0
    for (const result of prizepicksResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeTeam, result.event.awayTeam)
      if (!eventId) { ppUnmatched++; continue }
      ppMatched++
      for (const prop of result.props) {
        propRows.push(buildPropRow(eventId, prizepicksSourceId, prop, now))
      }
    }
    console.log(`[PrizePicks] games matched=${ppMatched} unmatched=${ppUnmatched} props=${prizepicksResults.reduce((s, r) => s + r.props.length, 0)}`)
  }

  // Underdog is scraped from a separate cron endpoint (/api/cron/sync-underdog)
  // to isolate its 16MB payload from sync-props' memory budget.

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

      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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

      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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

    const title = `${result.event.homeName} vs ${result.event.awayName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()

    if (newEvent) {
      eventsCreated++
      registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id, result.event.homeName)
    }
  }

  // FanDuel game markets
  if (fdSourceId) {
    for (const result of fdResults) {
      const leagueSlug = result.event.leagueSlug
      const eventId = findEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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

    const title = `${result.event.homeName} vs ${result.event.awayName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) {
      eventsCreated++
      registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id, result.event.homeName)
    }
  }

  // Betway game markets + player props
  if (bwSourceId) {
    for (const result of bwResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue

      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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
    const title = `${result.event.homeName} vs ${result.event.awayName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id, result.event.homeName) }
  }

  if (mgmSourceId) {
    for (const result of mgmResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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
    const title = `${result.event.homeName} vs ${result.event.awayName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id, result.event.homeName) }
  }

  if (bwinSourceId) {
    for (const result of bwinResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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
    const title = `${result.event.homeName} vs ${result.event.awayName}`
    const { data: newEvent } = await db
      .from('events')
      .insert({ title, start_time: result.event.startTime, status: 'scheduled', league_id: leagueId, external_id: makeExternalId(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName) })
      .select('id').single()
    if (newEvent) { eventsCreated++; registerEvent(leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName, newEvent.id, result.event.homeName) }
  }

  if (ppSourceId) {
    for (const result of ppResults) {
      const eventId = findEvent(result.event.leagueSlug, result.event.startTime, result.event.homeName, result.event.awayName)
      if (!eventId) continue
      for (const rawGm of result.gameMarkets) {
        const gm = orientGM(rawGm, eventId, result.event.homeName, result.event.awayName)
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

  // PointsBet is handled by the Railway worker — skip HTTP adapter block.

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

  if (syncedSlugs.size > 0) {
    await db
      .from('data_pipelines')
      .update({ last_checked_at: now, last_success_at: now, status: 'healthy', consecutive_failures: 0, circuit_open_at: null })
      .in('slug', [...syncedSlugs])
  }

  // Dedup propRows: if the same (event, source, category, player, line) appears
  // multiple times, prefer the row with both over AND under prices (complete O/U
  // market) over one-sided threshold entries. This prevents "To Record 2+ X" at
  // +900 from overwriting a legitimate O/U market at -150/+120 and creating fake arbs.
  const dedupMap = new Map<string, PropRow>()
  for (const row of propRows) {
    const key = propKey(row.event_id, row.source_id, row.prop_category, row.player_name, row.line_value)
    const existing = dedupMap.get(key)
    if (existing) {
      const existingHasBoth = existing.over_price != null && existing.under_price != null
      const newHasBoth = row.over_price != null && row.under_price != null
      // Keep the more complete entry (has both sides)
      if (existingHasBoth && !newHasBoth) continue
    }
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
  // PostgREST caps un-ranged SELECTs at 1000 rows by default — with the
  // full Pinnacle + Kambi + DK + FD + BetMGM prop catalog that cap was
  // silently truncating existingProps, so every prop beyond row 1000
  // got treated as "new" and re-upserted on every 2-min cycle. Paginate
  // explicitly so change detection sees all existing rows.
  const eventIds = [...new Set(dedupedRows.map(r => r.event_id))]
  const existingProps: Array<{
    event_id: string; source_id: string; prop_category: string;
    player_name: string; line_value: number | null; odds_hash: string
  }> = []
  const EXISTING_PAGE = 1000
  for (let offset = 0; ; offset += EXISTING_PAGE) {
    const { data: page } = await db
      .from('prop_odds')
      .select('event_id, source_id, prop_category, player_name, line_value, odds_hash')
      .in('event_id', eventIds)
      .range(offset, offset + EXISTING_PAGE - 1)
    if (!page || page.length === 0) break
    existingProps.push(...(page as typeof existingProps))
    if (page.length < EXISTING_PAGE) break
  }

  const existingHashMap = new Map<string, string>()
  for (const ep of existingProps) {
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
  // CRITICAL: scope update to EXACTLY the (event, source, category, player, line)
  // tuples that were refetched. Old code updated ALL rows matching (event, source)
  // which kept stale/orphaned rows (e.g., 1st-quarter markets rejected by parser)
  // alive indefinitely — their snapshot_time got refreshed even though they were
  // no longer in the adapter's output.
  if (unchanged.length > 0) {
    // Group by (event, source, category) — narrow scope with .in() on players
    const groups = new Map<string, Set<string>>()
    const rowMap = new Map<string, Array<{ player: string; line: number | null }>>()
    for (const r of unchanged) {
      const key = `${r.event_id}|${r.source_id}|${r.prop_category}`
      if (!rowMap.has(key)) rowMap.set(key, [])
      rowMap.get(key)!.push({ player: r.player_name, line: r.line_value })
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key)!.add(r.player_name)
    }

    for (const [key, players] of groups) {
      const [eid, sid, category] = key.split('|')
      const playerList = [...players]
      // Update in chunks of 100 players to avoid URL length limits
      for (let i = 0; i < playerList.length; i += 100) {
        const chunk = playerList.slice(i, i + 100)
        await db
          .from('prop_odds')
          .update({ snapshot_time: now })
          .eq('event_id', eid)
          .eq('source_id', sid)
          .eq('prop_category', category)
          .in('player_name', chunk)
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

  // Discord alerts moved to /api/cron/random-arb-alert (runs every 15 min)
  const alertsSent = 0

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

// Must stay aligned with lib/pipelines/normalize.ts and
// worker/src/lib/canonical.ts TEAM_CITY_ALIASES. sync-props has its own
// event-matching index (findEvent / makeMatchKey), but the normalization
// MUST produce the same canonical team string the rest of the pipeline
// uses or a DK/Pinnacle/Kambi scrape sending "HOU Rockets" won't find
// the "Houston Rockets" event row the canonical-key path already wrote.
// 3-letter prefixes listed before 2-letter so startsWith picks the more
// specific one first.
const TEAM_CITY_ALIASES: Record<string, string> = {
  // 3-letter
  'okc ': 'oklahoma city ', 'okc': 'oklahoma city',
  'phi ': 'philadelphia ',  'phi': 'philadelphia',
  'phx ': 'phoenix ',       'phx': 'phoenix',
  'pho ': 'phoenix ',       'pho': 'phoenix',
  'hou ': 'houston ',       'hou': 'houston',
  'por ': 'portland ',      'por': 'portland',
  'orl ': 'orlando ',       'orl': 'orlando',
  'chi ': 'chicago ',       'chi': 'chicago',
  'det ': 'detroit ',       'det': 'detroit',
  'atl ': 'atlanta ',       'atl': 'atlanta',
  'bos ': 'boston ',        'bos': 'boston',
  'was ': 'washington ',    'was': 'washington',
  'wsh ': 'washington ',    'wsh': 'washington',
  'dal ': 'dallas ',        'dal': 'dallas',
  'den ': 'denver ',        'den': 'denver',
  'mia ': 'miami ',         'mia': 'miami',
  'min ': 'minnesota ',     'min': 'minnesota',
  'mil ': 'milwaukee ',     'mil': 'milwaukee',
  'mem ': 'memphis ',       'mem': 'memphis',
  'ind ': 'indiana ',       'ind': 'indiana',
  'sac ': 'sacramento ',    'sac': 'sacramento',
  'uta ': 'utah ',          'uta': 'utah',
  'cle ': 'cleveland ',     'cle': 'cleveland',
  'nsh ': 'nashville ',     'nsh': 'nashville',
  'cgy ': 'calgary ',       'cgy': 'calgary',
  'van ': 'vancouver ',     'van': 'vancouver',
  'edm ': 'edmonton ',      'edm': 'edmonton',
  'mtl ': 'montreal ',      'mtl': 'montreal',
  'ott ': 'ottawa ',        'ott': 'ottawa',
  'wpg ': 'winnipeg ',      'wpg': 'winnipeg',
  'buf ': 'buffalo ',       'buf': 'buffalo',
  'cin ': 'cincinnati ',    'cin': 'cincinnati',
  'pit ': 'pittsburgh ',    'pit': 'pittsburgh',
  'bal ': 'baltimore ',     'bal': 'baltimore',
  'jax ': 'jacksonville ',  'jax': 'jacksonville',
  'ten ': 'tennessee ',     'ten': 'tennessee',
  'car ': 'carolina ',      'car': 'carolina',
  'ari ': 'arizona ',       'ari': 'arizona',
  'cha ': 'charlotte ',     'cha': 'charlotte',
  'col ': 'colorado ',      'col': 'colorado',
  'sea ': 'seattle ',       'sea': 'seattle',
  'tor ': 'toronto ',       'tor': 'toronto',
  // 2-letter
  'la ': 'los angeles ',    'la': 'los angeles',
  'ny ': 'new york ',       'ny': 'new york',
  'sf ': 'san francisco ',  'sf': 'san francisco',
  'gs ': 'golden state ',   'gs': 'golden state',
  'sa ': 'san antonio ',    'sa': 'san antonio',
  'sd ': 'san diego ',      'sd': 'san diego',
  'kc ': 'kansas city ',    'kc': 'kansas city',
  'gb ': 'green bay ',      'gb': 'green bay',
  'lv ': 'las vegas ',      'lv': 'las vegas',
  'ne ': 'new england ',    'ne': 'new england',
  'no ': 'new orleans ',    'no': 'new orleans',
  'nj ': 'new jersey ',     'nj': 'new jersey',
  'tb ': 'tampa bay ',      'tb': 'tampa bay',
  // Nicknames
  'philly ': 'philadelphia ', 'philly': 'philadelphia',
  'sixers': '76ers',
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
