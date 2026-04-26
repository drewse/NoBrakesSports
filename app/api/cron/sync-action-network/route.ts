// GET /api/cron/sync-action-network
//
// Action Network is a public US odds aggregator — `/scoreboard/{league}`
// returns a JSON payload whose every game carries an array of `odds`
// entries, one per sportsbook (`book_id`). One adapter, many books.
//
// What we get for free (no auth, no proxy, direct from Vercel):
//   bet365 NJ/ON, Caesars NJ, Hard Rock FL, Fanatics MI, theScore MO,
//   plus DK/FD/MGM/BetRivers/etc. that we already pull ourselves.
//
// To avoid double-writing books we already scrape directly, we SKIP the
// book_ids that map to a source we have a dedicated adapter for. The
// remaining books each resolve to one market_sources row (state-specific
// AN entries collapse onto a single brand slug — Caesars NJ and Caesars
// are the same book to us).
//
// Endpoint:
//   GET https://api.actionnetwork.com/web/v1/scoreboard/{league}
//   No auth, public.
// Game shape:
//   { id, start_time, away_team_id, home_team_id, teams: [{id, full_name}],
//     odds: [{ book_id, ml_home, ml_away, spread_home, spread_away,
//              spread_home_line, spread_away_line, total, over, under, ... }] }

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { americanToImpliedProb } from '@/lib/pipelines/prop-normalizer'

export const runtime = 'nodejs'
export const maxDuration = 90
export const dynamic = 'force-dynamic'

const AN_BASE = 'https://api.actionnetwork.com/web/v1/scoreboard'
const AN_LEAGUES = ['nba', 'mlb', 'nhl', 'nfl', 'ncaab', 'ncaaf'] as const
type AnLeague = typeof AN_LEAGUES[number]

const HEADERS: Record<string, string> = {
  Accept:        'application/json',
  'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0',
}

// Book IDs we DO pull directly (DK, FD, MGM, BetRivers, Pinnacle). The
// AN aggregator carries them too but our own scrapes are authoritative;
// skip to avoid clobbering rows that another cron just wrote.
const SKIP_BOOK_IDS = new Set([
  68,   // DK NJ
  69,   // FanDuel NJ (alt id)
  71,   // FanDuel NJ
  75,   // BetMGM NJ
  // BetRivers state-specific (we have BetRivers ON)
  121, 250, 262, 348, 1078, 1204, 1831, 1964,
  // Meta lines, not real books
  15,   // Consensus
  30,   // Open
  // Greek market — out of scope
  2991, // Vistabet GRC
])

// AN book_id → our market_sources slug + display name. State-specific AN
// entries collapse onto a single brand (we don't model state separately).
const BOOK_MAP: Record<number, { slug: string; name: string }> = {
  79:   { slug: 'bet365',      name: 'bet365' },
  1270: { slug: 'bet365',      name: 'bet365' },
  123:  { slug: 'caesars',     name: 'Caesars' },
  2725: { slug: 'hardrockbet', name: 'Hard Rock Bet' },
  2790: { slug: 'fanatics',    name: 'Fanatics' },
  4562: { slug: 'thescore',    name: 'theScore Bet' },
}

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return secret === process.env.CRON_SECRET || secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
}

function round4(n: number): number { return Math.round(n * 10000) / 10000 }

function pairKey(a: string, b: string) {
  return [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join('|')
}

interface AnTeam { id: number; full_name: string }
interface AnOdds {
  book_id: number
  ml_home: number | null
  ml_away: number | null
  spread_home: number | null
  spread_away: number | null
  spread_home_line: number | null
  spread_away_line: number | null
  total: number | null
  over: number | null
  under: number | null
  draw?: number | null
}
interface AnGame {
  id: number
  start_time: string
  away_team_id: number
  home_team_id: number
  teams?: AnTeam[]
  odds?: AnOdds[] | Record<string, AnOdds>
}
interface AnScoreboard {
  league?: { name?: string }
  games?: AnGame[]
}

async function fetchScoreboard(league: AnLeague): Promise<AnGame[]> {
  const r = await fetch(`${AN_BASE}/${league}`, { headers: HEADERS })
  if (!r.ok) return []
  const j = (await r.json()) as AnScoreboard
  return j.games ?? []
}

function teamsByGame(g: AnGame): { home: string; away: string } | null {
  const teams = g.teams ?? []
  const byId = new Map(teams.map(t => [t.id, t.full_name]))
  const home = byId.get(g.home_team_id)
  const away = byId.get(g.away_team_id)
  if (!home || !away) return null
  return { home, away }
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const start = Date.now()
  const db = createAdminClient()

  // 1. Fetch every league in parallel
  const leagueResults = await Promise.all(
    AN_LEAGUES.map(async L => ({ league: L as AnLeague, games: await fetchScoreboard(L) })),
  )

  // 2. Resolve / create one market_sources row per distinct book slug we
  //    plan to write. Cache the slug→id mapping for the rest of the run.
  const wantedSlugs = new Set<string>()
  for (const m of Object.values(BOOK_MAP)) wantedSlugs.add(m.slug)
  const slugToSourceId = new Map<string, string>()
  for (const slug of wantedSlugs) {
    const meta = Object.values(BOOK_MAP).find(m => m.slug === slug)!
    let { data: existing } = await db
      .from('market_sources').select('id').eq('slug', slug).maybeSingle()
    if (!existing) {
      const { data: created } = await db
        .from('market_sources')
        .insert({ name: meta.name, slug, source_type: 'sportsbook', is_active: true })
        .select('id').single()
      existing = created
    }
    if (existing?.id) slugToSourceId.set(slug, existing.id as string)
  }

  // 3. Load canonical events. Window includes games started up to 4h ago
  //    so AN's lines for in-flight games still match — AN's scoreboard
  //    keeps publishing lines through the live window.
  const sinceIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time, leagues(slug)')
    .gt('start_time', sinceIso)
    .limit(5000)

  const eventByKey = new Map<string, string>()
  for (const e of (dbEvents ?? []) as any[]) {
    const slug = e.leagues?.slug
    const title = e.title as string
    if (!slug || !title) continue
    const parts = title.split(/\s+vs\.?\s+/i)
    if (parts.length !== 2) continue
    const day = String(e.start_time).slice(0, 10)
    eventByKey.set(`${slug}|${pairKey(parts[0], parts[1])}|${day}`, e.id as string)
  }

  // 4. Walk each game's odds entries and build markets per book.
  const now = new Date().toISOString()
  const marketSnapshots: any[] = []
  const currentByKey = new Map<string, any>() // (event, source, market_type, line_value)

  let matchedGames = 0, unmatchedGames = 0
  const perBook: Record<string, number> = {}
  const skippedBookIds = new Map<number, number>()

  for (const { league, games } of leagueResults) {
    for (const g of games) {
      const teams = teamsByGame(g)
      if (!teams) continue
      const day = g.start_time.slice(0, 10)
      const eid = eventByKey.get(`${league}|${pairKey(teams.home, teams.away)}|${day}`)
      if (!eid) { unmatchedGames++; continue }
      matchedGames++

      const odds = Array.isArray(g.odds) ? g.odds : (g.odds ? Object.values(g.odds) : [])
      for (const o of odds as AnOdds[]) {
        if (SKIP_BOOK_IDS.has(o.book_id)) continue
        const meta = BOOK_MAP[o.book_id]
        if (!meta) {
          skippedBookIds.set(o.book_id, (skippedBookIds.get(o.book_id) ?? 0) + 1)
          continue
        }
        const sourceId = slugToSourceId.get(meta.slug)
        if (!sourceId) continue
        perBook[meta.slug] = (perBook[meta.slug] ?? 0) + 1

        const writeMarket = (
          marketType: string, line: number,
          home: number | null, away: number | null,
          spreadValue: number | null, totalValue: number | null,
          overP: number | null, underP: number | null,
          drawP: number | null,
        ) => {
          const homeProb = home != null ? round4(americanToImpliedProb(home)) : null
          const awayProb = away != null ? round4(americanToImpliedProb(away)) : null
          const oddsHash = [home, away, drawP, spreadValue, totalValue, overP, underP].map(v => v ?? '').join('|')
          marketSnapshots.push({
            event_id: eid, source_id: sourceId, market_type: marketType,
            home_price: home, away_price: away, draw_price: drawP,
            spread_value: spreadValue, total_value: totalValue,
            over_price: overP, under_price: underP,
            home_implied_prob: homeProb, away_implied_prob: awayProb,
            snapshot_time: now,
          })
          currentByKey.set(`${eid}|${sourceId}|${marketType}|${line}`, {
            event_id: eid, source_id: sourceId, market_type: marketType,
            line_value: line, odds_hash: oddsHash,
            home_price: home, away_price: away, draw_price: drawP,
            spread_value: spreadValue, total_value: totalValue,
            over_price: overP, under_price: underP,
            home_implied_prob: homeProb, away_implied_prob: awayProb,
            movement_direction: 'flat',
            snapshot_time: now, changed_at: now,
          })
        }

        if (o.ml_home != null && o.ml_away != null) {
          writeMarket('moneyline', 0, o.ml_home, o.ml_away, null, null, null, null, o.draw ?? null)
        }
        if (
          o.spread_home_line != null && o.spread_away_line != null &&
          o.spread_home != null
        ) {
          const spreadAbs = Math.abs(o.spread_home)
          writeMarket('spread', 0, o.spread_home_line, o.spread_away_line, spreadAbs, null, null, null, null)
        }
        if (o.total != null && o.over != null && o.under != null) {
          writeMarket('total', 0, null, null, null, o.total, o.over, o.under, null)
        }
      }
    }
  }

  // 5. Persist
  const errors: string[] = []
  let snapshotsInserted = 0
  for (let i = 0; i < marketSnapshots.length; i += 200) {
    const { error } = await db.from('market_snapshots').insert(marketSnapshots.slice(i, i + 200))
    if (error) errors.push(`snap batch ${i / 200}: ${error.message}`)
    else snapshotsInserted += Math.min(200, marketSnapshots.length - i)
  }
  const currentRows = [...currentByKey.values()]
  let currentUpserted = 0
  for (let i = 0; i < currentRows.length; i += 200) {
    const { error } = await db.from('current_market_odds').upsert(
      currentRows.slice(i, i + 200),
      { onConflict: 'event_id,source_id,market_type,line_value' },
    )
    if (error) errors.push(`cmo batch ${i / 200}: ${error.message}`)
    else currentUpserted += Math.min(200, currentRows.length - i)
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - start,
    leagues: leagueResults.map(l => ({ league: l.league, games: l.games.length })),
    matchedGames, unmatchedGames,
    perBook,
    snapshotsInserted, currentUpserted,
    unknownBookIds: Object.fromEntries(skippedBookIds),
    errors: errors.length ? errors : undefined,
  })
}
