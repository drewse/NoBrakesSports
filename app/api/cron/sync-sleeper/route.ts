/**
 * Sleeper Picks sync — isolated cron (like sync-underdog).
 *
 * Sleeper's /lines/available doesn't expose home/away flags or scheduled_at.
 * We receive a set of two subject_team abbreviations per game_id and must
 * match to a canonical event by (league, {teamA, teamB}) rather than the
 * exact (league, start, home, away) canonicalEventKey sync-props uses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { scrapeSleeper, __lastScrapeStats as sleeperStats } from '@/lib/pipelines/adapters/sleeper-props'
import { computePropOddsHash, americanToImpliedProb, type NormalizedProp } from '@/lib/pipelines/prop-normalizer'

export const runtime = 'nodejs'
export const maxDuration = 90
export const dynamic = 'force-dynamic'

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return secret === process.env.CRON_SECRET || secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
}

function round4(n: number): number { return Math.round(n * 10000) / 10000 }

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // 1) Scrape
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 75_000)
  let results: Awaited<ReturnType<typeof scrapeSleeper>>
  try {
    results = await scrapeSleeper(controller.signal)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  } finally {
    clearTimeout(timer)
  }
  if (results.length === 0) {
    // Echo the adapter's skip counters so we can diagnose why no games
    // came through without waiting on Vercel log indexing.
    return NextResponse.json({
      ok: true, games: 0, props: 0, matched: 0,
      debug: {
        ...sleeperStats,
        topUnmappedWagerTypes: Object.entries(sleeperStats.unmappedWagerTypes)
          .sort((a, b) => b[1] - a[1]).slice(0, 10),
      },
    })
  }

  // 2) Source row
  let { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', 'sleeper')
    .maybeSingle()
  if (!source) {
    const { data: created } = await db
      .from('market_sources')
      .insert({ name: 'Sleeper Picks', slug: 'sleeper', source_type: 'dfs', is_active: true })
      .select('id')
      .single()
    source = created
  }
  if (!source) {
    return NextResponse.json({ error: 'failed to resolve sleeper market_source' }, { status: 500 })
  }
  const sourceId = source.id as string

  // 3) Abbreviation → full team name lookup. Our teams table is sparsely
  //    seeded (first cron fire showed 0/18 matches because most rows
  //    don't exist), so we bake in the major-league maps directly. When
  //    teams table is populated, it augments this table — not the other
  //    way around.
  const HARDCODED_ABBRS: Record<string, Record<string, string>> = {
    nba: {
      ATL:'Atlanta Hawks', BOS:'Boston Celtics', BKN:'Brooklyn Nets',
      CHA:'Charlotte Hornets', CHI:'Chicago Bulls', CLE:'Cleveland Cavaliers',
      DAL:'Dallas Mavericks', DEN:'Denver Nuggets', DET:'Detroit Pistons',
      GSW:'Golden State Warriors', HOU:'Houston Rockets', IND:'Indiana Pacers',
      LAC:'LA Clippers', LAL:'Los Angeles Lakers', MEM:'Memphis Grizzlies',
      MIA:'Miami Heat', MIL:'Milwaukee Bucks', MIN:'Minnesota Timberwolves',
      NOP:'New Orleans Pelicans', NYK:'New York Knicks', OKC:'Oklahoma City Thunder',
      ORL:'Orlando Magic', PHI:'Philadelphia 76ers', PHX:'Phoenix Suns',
      POR:'Portland Trail Blazers', SAC:'Sacramento Kings', SAS:'San Antonio Spurs',
      TOR:'Toronto Raptors', UTA:'Utah Jazz', WAS:'Washington Wizards',
    },
    wnba: {
      ATL:'Atlanta Dream', CHI:'Chicago Sky', CON:'Connecticut Sun',
      DAL:'Dallas Wings', IND:'Indiana Fever', LVA:'Las Vegas Aces',
      LAS:'Las Vegas Aces', LAK:'Los Angeles Sparks', LAS2:'Los Angeles Sparks',
      MIN:'Minnesota Lynx', NYL:'New York Liberty', PHX:'Phoenix Mercury',
      SEA:'Seattle Storm', WAS:'Washington Mystics', GSV:'Golden State Valkyries',
    },
    mlb: {
      ARI:'Arizona Diamondbacks', ATL:'Atlanta Braves', BAL:'Baltimore Orioles',
      BOS:'Boston Red Sox', CHC:'Chicago Cubs', CWS:'Chicago White Sox',
      CHW:'Chicago White Sox', CIN:'Cincinnati Reds', CLE:'Cleveland Guardians',
      COL:'Colorado Rockies', DET:'Detroit Tigers', HOU:'Houston Astros',
      KAN:'Kansas City Royals', KC:'Kansas City Royals', KCR:'Kansas City Royals',
      LAA:'Los Angeles Angels', ANA:'Los Angeles Angels',
      LAD:'Los Angeles Dodgers', MIA:'Miami Marlins', MIL:'Milwaukee Brewers',
      MIN:'Minnesota Twins', NYM:'New York Mets', NYY:'New York Yankees',
      OAK:'Oakland Athletics', ATH:'Athletics', PHI:'Philadelphia Phillies',
      PIT:'Pittsburgh Pirates', SDP:'San Diego Padres', SD:'San Diego Padres',
      SEA:'Seattle Mariners', SFG:'San Francisco Giants', SF:'San Francisco Giants',
      STL:'St. Louis Cardinals', TBR:'Tampa Bay Rays', TB:'Tampa Bay Rays',
      TEX:'Texas Rangers', TOR:'Toronto Blue Jays', WAS:'Washington Nationals',
      WSH:'Washington Nationals', AZ:'Arizona Diamondbacks',
    },
    nhl: {
      ANA:'Anaheim Ducks', ARI:'Arizona Coyotes', BOS:'Boston Bruins',
      BUF:'Buffalo Sabres', CGY:'Calgary Flames', CAR:'Carolina Hurricanes',
      CHI:'Chicago Blackhawks', COL:'Colorado Avalanche', CBJ:'Columbus Blue Jackets',
      DAL:'Dallas Stars', DET:'Detroit Red Wings', EDM:'Edmonton Oilers',
      FLA:'Florida Panthers', LAK:'Los Angeles Kings', LA:'Los Angeles Kings',
      MIN:'Minnesota Wild', MTL:'Montreal Canadiens', MON:'Montreal Canadiens',
      NSH:'Nashville Predators', NJD:'New Jersey Devils', NJ:'New Jersey Devils',
      NYI:'New York Islanders', NYR:'New York Rangers', OTT:'Ottawa Senators',
      PHI:'Philadelphia Flyers', PIT:'Pittsburgh Penguins', SJS:'San Jose Sharks',
      SJ:'San Jose Sharks', SEA:'Seattle Kraken', STL:'St. Louis Blues',
      TBL:'Tampa Bay Lightning', TB:'Tampa Bay Lightning', TOR:'Toronto Maple Leafs',
      UTA:'Utah Hockey Club', VAN:'Vancouver Canucks', VGK:'Vegas Golden Knights',
      WSH:'Washington Capitals', WAS:'Washington Capitals', WPG:'Winnipeg Jets',
    },
    nfl: {},
  }

  // Also pull DB teams rows so any custom/seeded entries augment the hardcoded
  // map without overriding it.
  const { data: teamsRows } = await db
    .from('teams')
    .select('abbreviation, name, city, leagues(slug)')
  const fullByLeagueAbbr = new Map<string, string>()
  for (const [slug, m] of Object.entries(HARDCODED_ABBRS)) {
    for (const [abbr, full] of Object.entries(m)) {
      fullByLeagueAbbr.set(`${slug}|${abbr.toUpperCase()}`, full)
    }
  }
  for (const t of (teamsRows ?? []) as any[]) {
    const slug = t.leagues?.slug
    const abbr = t.abbreviation
    if (!slug || !abbr) continue
    const full = [t.city, t.name].filter(Boolean).join(' ').trim()
    if (full) fullByLeagueAbbr.set(`${slug}|${abbr.toUpperCase()}`, full)
  }

  // 4) Fetch upcoming events once; build a lookup keyed by (league,
  //    sortedPairKey) so we can match regardless of home/away order.
  const nowIso = new Date().toISOString()
  const { data: events } = await db
    .from('events')
    .select('id, title, start_time, leagues(slug)')
    .gt('start_time', nowIso)
    .limit(5000)

  function teamsKey(a: string, b: string) {
    return [a.toLowerCase().trim(), b.toLowerCase().trim()].sort().join('|')
  }
  const eventByKey = new Map<string, string>()  // `${slug}|sortedPair` → eventId
  for (const e of (events ?? []) as any[]) {
    const slug = e.leagues?.slug
    const title = e.title as string
    if (!slug || !title) continue
    const parts = title.split(/\s+vs\.?\s+/i)
    if (parts.length !== 2) continue
    eventByKey.set(`${slug}|${teamsKey(parts[0], parts[1])}`, e.id as string)
  }

  // 5) Build prop rows
  const now = new Date().toISOString()
  type PropRow = {
    event_id: string; source_id: string; prop_category: string; player_name: string
    line_value: number | null; over_price: number | null; under_price: number | null
    yes_price: number | null; no_price: number | null
    over_implied_prob: number | null; under_implied_prob: number | null
    odds_hash: string; snapshot_time: string; changed_at: string
  }
  function buildRow(eventId: string, p: NormalizedProp): PropRow {
    return {
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
      odds_hash: computePropOddsHash(p.overPrice, p.underPrice, p.yesPrice, p.noPrice),
      snapshot_time: now,
      changed_at: now,
    }
  }

  let matched = 0
  let unmatchedAbbr = 0     // team abbr didn't resolve to a full name
  let unmatchedEvent = 0    // resolved but no event row for that pair
  const rows: PropRow[] = []
  for (const r of results) {
    const hf = fullByLeagueAbbr.get(`${r.event.leagueSlug}|${r.event.homeTeamAbbr.toUpperCase()}`)
    const af = fullByLeagueAbbr.get(`${r.event.leagueSlug}|${r.event.awayTeamAbbr.toUpperCase()}`)
    if (!hf || !af) { unmatchedAbbr++; continue }
    const eid = eventByKey.get(`${r.event.leagueSlug}|${teamsKey(hf, af)}`)
    if (!eid) { unmatchedEvent++; continue }
    matched++
    for (const p of r.props) rows.push(buildRow(eid, p))
  }

  // 6) Upsert
  let inserted = 0
  const errors: string[] = []
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from('prop_odds')
      .upsert(rows.slice(i, i + CHUNK), {
        onConflict: 'source_id,event_id,prop_category,player_name,line_value',
      })
    if (error) errors.push(`batch ${Math.floor(i / CHUNK)}: ${error.message}`)
    else inserted += Math.min(CHUNK, rows.length - i)
  }

  await db.from('market_sources').update({ health_status: 'healthy', last_health_check: now }).eq('id', sourceId)

  return NextResponse.json({
    ok: true,
    games: results.length,
    propsScraped: rows.length,
    matched,
    unmatchedAbbr,
    unmatchedEvent,
    inserted,
    errors: errors.length ? errors : undefined,
  })
}
