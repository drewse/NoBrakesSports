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
  const db = getSupabase()
  const now = new Date().toISOString()
  const errors: string[] = []

  // ── 1. Resolve (or create) the market_sources row ──
  let { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', ctx.sourceSlug)
    .maybeSingle()
  if (!source) {
    const { data: created, error } = await db
      .from('market_sources')
      .insert({ name: ctx.sourceName, slug: ctx.sourceSlug, source_type: 'sportsbook', is_active: true })
      .select('id').single()
    if (error || !created) {
      return { eventsCreated: 0, eventsMatched: 0, gameMarketsUpserted: 0, propsUpserted: 0, errors: [`source insert: ${error?.message ?? 'unknown'}`] }
    }
    source = created
  }
  const sourceId: string = source.id

  // ── 2. Map league slugs to league_ids ──
  const { data: leaguesRaw } = await db.from('leagues').select('id, slug')
  const leagueIdBySlug = new Map<string, string>()
  for (const l of leaguesRaw ?? []) leagueIdBySlug.set(l.slug, l.id)

  // ── 3. Upcoming events lookup — fetch everything starting in the next few days ──
  const lookBack = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, external_id, league_id, league:leagues(slug)')
    .gt('start_time', lookBack)
  const eventByExtId = new Map<string, string>()
  const eventByMatchKey = new Map<string, string>()
  for (const e of (dbEvents ?? []) as any[]) {
    if (e.external_id) eventByExtId.set(e.external_id, e.id)
    const slug = e.league?.slug ?? ''
    if (slug && e.title) {
      const parts = (e.title as string).split(' vs ')
      if (parts.length === 2) {
        const key = canonicalEventKey({
          leagueSlug: slug, startTime: e.start_time,
          homeTeam: parts[1].trim(), awayTeam: parts[0].trim(),
        })
        eventByMatchKey.set(key, e.id)
      }
    }
  }

  // ── 4. Per-event processing ──
  let eventsCreated = 0
  let eventsMatched = 0

  // Batched rows for bulk upsert
  const gameRows: any[] = []
  const propRows: any[] = []

  for (const result of results) {
    const { event, gameMarkets, props } = result
    const leagueId = leagueIdBySlug.get(event.leagueSlug)
    if (!leagueId) {
      errors.push(`unknown league: ${event.leagueSlug}`)
      continue
    }
    const extId = canonicalEventKey({
      leagueSlug: event.leagueSlug,
      startTime: event.startTime,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
    })

    let eventId = eventByExtId.get(extId) ?? eventByMatchKey.get(extId)
    if (!eventId) {
      // Auto-create the event
      const title = `${event.awayTeam} vs ${event.homeTeam}`
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
      if (error || !newEvent) {
        errors.push(`event insert "${title}": ${error?.message ?? 'unknown'}`)
        continue
      }
      eventId = newEvent.id
      eventByExtId.set(extId, eventId!)
      eventsCreated++
    } else {
      eventsMatched++
    }

    // Game markets — one row per (event, source, market_type) using line_value=0 (NULL breaks unique constraints)
    for (const gm of gameMarkets) {
      const oddsHash = computeOddsHash({
        home_price: gm.homePrice, away_price: gm.awayPrice, draw_price: gm.drawPrice,
        spread_value: gm.spreadValue, total_value: gm.totalValue,
        over_price: gm.overPrice, under_price: gm.underPrice,
      })
      gameRows.push({
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
        home_implied_prob: gm.homePrice != null ? round4(americanToImpliedProb(gm.homePrice)) : null,
        away_implied_prob: gm.awayPrice != null ? round4(americanToImpliedProb(gm.awayPrice)) : null,
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
    eventsCreated, eventsMatched,
    gameMarketsUpserted, propsUpserted,
    errors: errors.length,
  })

  return { eventsCreated, eventsMatched, gameMarketsUpserted, propsUpserted, errors }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}
