import { getSupabase } from './supabase.js'
import { canonicalEventKey, americanToImpliedProb, computeOddsHash, computePropOddsHash } from './canonical.js'
import { createLogger } from './logger.js'
import type { ScrapedEvent } from './types.js'

const log = createLogger('writer')

interface WriterContext {
  sourceSlug: string
  sourceName: string
  sourceType?: 'sportsbook'
}

interface WriteResult {
  eventsCreated: number
  eventsMatched: number
  gameMarketsUpserted: number
  propsUpserted: number
  errors: string[]
}

/** Shared Supabase writer. Each adapter calls this with its scraped events. */
export async function writeBookResults(
  ctx: WriterContext,
  results: ScrapedEvent[]
): Promise<WriteResult> {
  log.info('write begin', { source: ctx.sourceSlug, inputEvents: results.length, build: 'v3' })
  const db = getSupabase()
  const now = new Date().toISOString()
  const errors: string[] = []

  // ── 1. Resolve (or create) the market_sources row ──
  const { data: existing, error: lookupErr } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', ctx.sourceSlug)
    .maybeSingle()
  if (lookupErr) {
    log.error('market_sources lookup failed', { slug: ctx.sourceSlug, message: lookupErr.message, code: lookupErr.code })
  }
  let sourceId: string | undefined = existing?.id
  if (!sourceId) {
    const { data: created, error: insertErr } = await db
      .from('market_sources')
      .insert({ name: ctx.sourceName, slug: ctx.sourceSlug, source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (created?.id) {
      sourceId = created.id
    } else if (insertErr?.code === '23505') {
      // Race / RLS / soft-filter — row actually exists, re-lookup
      const { data: retry } = await db.from('market_sources').select('id').eq('slug', ctx.sourceSlug).maybeSingle()
      sourceId = retry?.id
    }
    if (!sourceId) {
      log.error('market_sources resolve failed — aborting write', {
        slug: ctx.sourceSlug,
        lookupErr: lookupErr?.message ?? null,
        insertErr: insertErr?.message ?? null,
      })
      return { eventsCreated: 0, eventsMatched: 0, gameMarketsUpserted: 0, propsUpserted: 0, errors: [`source resolve: ${insertErr?.message ?? lookupErr?.message ?? 'unknown'}`] }
    }
  }
  log.debug('source resolved', { slug: ctx.sourceSlug, sourceId })

  // ── 2. Map league slugs to league_ids ──
  const { data: leaguesRaw } = await db.from('leagues').select('id, slug')
  const leagueIdBySlug = new Map<string, string>()
  for (const l of leaguesRaw ?? []) leagueIdBySlug.set(l.slug, l.id)

  // ── 3. Upcoming events lookup — fetch everything starting in the next few days ──
  const lookBack = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const normTeam = (s: string) =>
    s.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  const homeTeamsMatch = (a: string, b: string): boolean => normTeam(a) === normTeam(b)

  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, external_id, league_id, league:leagues(slug)')
    .gt('start_time', lookBack)
  // Store both title parts per event so we can decide which one the CURRENT
  // adapter treats as home at lookup time. Historic events in the DB were
  // created under mixed title conventions ("Home vs Away" from sync-odds,
  // "Away vs Home" from sync-props cron and the worker), so there is no
  // single position we can trust universally.
  const eventByExtId = new Map<string, { id: string; titleParts: [string, string] }>()
  const eventByMatchKey = new Map<string, { id: string; titleParts: [string, string] }>()
  for (const e of (dbEvents ?? []) as any[]) {
    const slug = e.league?.slug ?? ''
    if (!slug || !e.title) continue
    const parts = (e.title as string).split(' vs ')
    if (parts.length !== 2) continue
    const entry = { id: e.id as string, titleParts: [parts[0].trim(), parts[1].trim()] as [string, string] }
    if (e.external_id) eventByExtId.set(e.external_id, entry)
    // Canonical key sorts teams, so the same key works for either ordering.
    const key = canonicalEventKey({
      leagueSlug: slug, startTime: e.start_time,
      homeTeam: parts[0].trim(), awayTeam: parts[1].trim(),
    })
    eventByMatchKey.set(key, entry)
  }

  /** Figure out the DB event's home team from the title parts by looking for
   *  the adapter's team names inside them. Works with either "Home vs Away"
   *  or "Away vs Home" stored-title conventions. Falls back to the adapter's
   *  home team (no swap) when neither name matches (different labeling). */
  function resolveDbHome(parts: [string, string], adapterHome: string, adapterAway: string): string {
    const p0 = normTeam(parts[0])
    const p1 = normTeam(parts[1])
    const h = normTeam(adapterHome)
    const a = normTeam(adapterAway)
    if (p0 === h || p1 === a) return parts[0]
    if (p1 === h || p0 === a) return parts[1]
    return adapterHome
  }

  // ── 4. Per-event processing ──
  let eventsCreated = 0
  let eventsMatched = 0
  let skippedNoLeague = 0
  const missingLeagues = new Set<string>()

  // Batched rows for bulk upsert
  const gameRows: any[] = []
  const propRows: any[] = []

  for (const result of results) {
    const { event, gameMarkets, props } = result
    const leagueId = leagueIdBySlug.get(event.leagueSlug)
    if (!leagueId) {
      missingLeagues.add(event.leagueSlug)
      skippedNoLeague++
      continue
    }
    const extId = canonicalEventKey({
      leagueSlug: event.leagueSlug,
      startTime: event.startTime,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
    })

    const matched = eventByExtId.get(extId) ?? eventByMatchKey.get(extId)
    let eventId = matched?.id
    let dbHomeTeam = matched
      ? resolveDbHome(matched.titleParts, event.homeTeam, event.awayTeam)
      : event.homeTeam
    if (!eventId) {
      // Auto-create the event. If another client (Vercel sync) inserted the
      // same event concurrently, use upsert semantics via select-on-conflict.
      // "Home vs Away" convention going forward (matches main app display).
      const title = `${event.homeTeam} vs ${event.awayTeam}`
      const { data: newEvent, error } = await db
        .from('events')
        .insert({
          title,
          start_time: event.startTime,
          status: 'scheduled',
          league_id: leagueId,
          external_id: extId,
        })
        .select('id')
        .single()
      if (error) {
        // 23505 = unique_violation. Another process beat us to the insert —
        // look it up by external_id and use that row.
        if (error.code === '23505') {
          const { data: existing } = await db
            .from('events')
            .select('id')
            .eq('external_id', extId)
            .maybeSingle()
          if (existing?.id) {
            eventId = existing.id
            eventByExtId.set(extId, { id: eventId!, titleParts: [event.homeTeam, event.awayTeam] })
            dbHomeTeam = event.homeTeam
            eventsMatched++
          } else {
            errors.push(`event conflict but no row: ${extId}`)
            continue
          }
        } else {
          errors.push(`event insert "${title}": ${error.message}`)
          continue
        }
      } else if (newEvent) {
        eventId = newEvent.id
        eventByExtId.set(extId, { id: eventId!, titleParts: [event.homeTeam, event.awayTeam] })
        dbHomeTeam = event.homeTeam
        eventsCreated++
      } else {
        errors.push(`event insert "${title}": no data returned`)
        continue
      }
    } else {
      eventsMatched++
    }

    // If the adapter's home/away assignment differs from the DB event's, swap
    // prices so they always land on the correct side. Critical: spread_value
    // also flips sign semantically, but we store it as Math.abs() already, so
    // only prices need swapping.
    const needsSwap = !homeTeamsMatch(event.homeTeam, dbHomeTeam)

    // Game markets — one row per (event, source, market_type) using line_value=0 (NULL breaks unique constraints)
    for (const gm of gameMarkets) {
      const homePrice = needsSwap ? gm.awayPrice : gm.homePrice
      const awayPrice = needsSwap ? gm.homePrice : gm.awayPrice
      const oddsHash = computeOddsHash({
        home_price: homePrice, away_price: awayPrice, draw_price: gm.drawPrice,
        spread_value: gm.spreadValue, total_value: gm.totalValue,
        over_price: gm.overPrice, under_price: gm.underPrice,
      })
      gameRows.push({
        event_id: eventId,
        source_id: sourceId,
        market_type: gm.marketType,
        line_value: 0,
        odds_hash: oddsHash,
        home_price: homePrice,
        away_price: awayPrice,
        draw_price: gm.drawPrice,
        spread_value: gm.spreadValue,
        total_value: gm.totalValue,
        over_price: gm.overPrice,
        under_price: gm.underPrice,
        home_implied_prob: homePrice != null ? round4(americanToImpliedProb(homePrice)) : null,
        away_implied_prob: awayPrice != null ? round4(americanToImpliedProb(awayPrice)) : null,
        movement_direction: 'flat',
        snapshot_time: now,
        changed_at: now,
      })
    }

    // Props
    for (const p of props) {
      const hash = computePropOddsHash(p.overPrice, p.underPrice, p.yesPrice, p.noPrice)
      propRows.push({
        event_id: eventId,
        source_id: sourceId,
        prop_category: p.propCategory,
        player_name: p.playerName,
        line_value: p.lineValue,
        over_price: p.overPrice,
        under_price: p.underPrice,
        yes_price: p.yesPrice,
        no_price: p.noPrice,
        over_implied_prob: p.overPrice != null ? round4(americanToImpliedProb(p.overPrice)) : null,
        under_implied_prob: p.underPrice != null ? round4(americanToImpliedProb(p.underPrice)) : null,
        odds_hash: hash,
        snapshot_time: now,
        changed_at: now,
      })
    }
  }

  // ── 5. Dedup + upsert game markets ──
  let gameMarketsUpserted = 0
  if (gameRows.length > 0) {
    const dedup = new Map<string, any>()
    for (const r of gameRows) {
      dedup.set(`${r.event_id}|${r.source_id}|${r.market_type}|${r.line_value}`, r)
    }
    const rows = [...dedup.values()]
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from('current_market_odds')
        .upsert(rows.slice(i, i + CHUNK), {
          onConflict: 'event_id,source_id,market_type,line_value',
        })
      if (error) errors.push(`game upsert: ${error.message}`)
      else gameMarketsUpserted += rows.slice(i, i + CHUNK).length
    }
  }

  // ── 6. Dedup + upsert props ──
  let propsUpserted = 0
  if (propRows.length > 0) {
    const dedup = new Map<string, any>()
    for (const r of propRows) {
      dedup.set(`${r.event_id}|${r.source_id}|${r.prop_category}|${r.player_name}|${r.line_value}`, r)
    }
    const rows = [...dedup.values()]
    const CHUNK = 500
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error } = await db
        .from('prop_odds')
        .upsert(rows.slice(i, i + CHUNK), {
          onConflict: 'event_id,source_id,prop_category,player_name,line_value',
        })
      if (error) errors.push(`prop upsert: ${error.message}`)
      else propsUpserted += rows.slice(i, i + CHUNK).length
    }
  }

  // ── 7. Pipeline heartbeat ──
  await db
    .from('data_pipelines')
    .update({
      last_checked_at: now,
      last_success_at: errors.length === 0 ? now : undefined,
      status: errors.length === 0 ? 'healthy' : 'degraded',
      consecutive_failures: 0,
    })
    .eq('slug', ctx.sourceSlug)

  log.info('write complete', {
    source: ctx.sourceSlug,
    eventsTotal: results.length,
    eventsCreated,
    eventsMatched,
    skippedNoLeague,
    missingLeagues: [...missingLeagues],
    gameMarketsQueued: gameRows.length,
    gameMarketsUpserted,
    propsQueued: propRows.length,
    propsUpserted,
    errorsCount: errors.length,
  })
  if (errors.length > 0) {
    for (const e of errors.slice(0, 10)) log.error('write error', { message: e })
  }

  return { eventsCreated, eventsMatched, gameMarketsUpserted, propsUpserted, errors }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
