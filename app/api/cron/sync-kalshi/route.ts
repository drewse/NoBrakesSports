import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKalshiMarkets, kalshiPriceToProb, type KalshiMarket } from '@/lib/data-sync/kalshi'

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

function round4(n: number): number { return Math.round(n * 10000) / 10000 }

/** Convert implied probability (0..1) → American odds. */
function probToAmerican(p: number): number | null {
  if (!isFinite(p) || p <= 0 || p >= 1) return null
  if (p >= 0.5) return Math.round(-(p / (1 - p)) * 100)
  return Math.round(((1 - p) / p) * 100)
}

// City / short-name → canonical full team name. Needed because Kalshi uses
// city-only or shortened team names in yes_sub_title (e.g. "Phoenix",
// "Oklahoma City") while our events.title uses full names ("Phoenix Suns",
// "Oklahoma City Thunder").
// City / short-name → full team name, scoped PER SPORT. Cities collide
// across leagues (Miami Heat/Marlins, Chicago Bulls/Cubs/White Sox, etc.)
// so a single map silently mis-resolves MLB/NHL contracts. Series ticker
// (KXNBAGAME / KXMLBGAME / KXNHLGAME / KXNFLGAME) determines which map.
type Sport = 'nba' | 'mlb' | 'nhl' | 'nfl'

const CITY_MAPS: Record<Sport, Record<string, string>> = {
  nba: {
    'Atlanta':'Atlanta Hawks','Boston':'Boston Celtics','Brooklyn':'Brooklyn Nets',
    'Charlotte':'Charlotte Hornets','Chicago':'Chicago Bulls',
    'Cleveland':'Cleveland Cavaliers','Dallas':'Dallas Mavericks',
    'Denver':'Denver Nuggets','Detroit':'Detroit Pistons',
    'Golden State':'Golden State Warriors','Houston':'Houston Rockets',
    'Indiana':'Indiana Pacers','LA Clippers':'LA Clippers','Clippers':'LA Clippers',
    'Los Angeles':'Los Angeles Lakers','LA Lakers':'Los Angeles Lakers','Lakers':'Los Angeles Lakers',
    // Kalshi single-letter disambiguators for the LA/NY dual-team cities
    'Los Angeles L':'Los Angeles Lakers','Los Angeles C':'LA Clippers',
    'Memphis':'Memphis Grizzlies','Miami':'Miami Heat',
    'Milwaukee':'Milwaukee Bucks','Minnesota':'Minnesota Timberwolves',
    'New Orleans':'New Orleans Pelicans','New York':'New York Knicks','Knicks':'New York Knicks',
    'Oklahoma City':'Oklahoma City Thunder','Orlando':'Orlando Magic',
    'Philadelphia':'Philadelphia 76ers','Phoenix':'Phoenix Suns',
    'Portland':'Portland Trail Blazers','Sacramento':'Sacramento Kings',
    'San Antonio':'San Antonio Spurs','Toronto':'Toronto Raptors',
    'Utah':'Utah Jazz','Washington':'Washington Wizards',
  },
  mlb: {
    'Arizona':'Arizona Diamondbacks','Atlanta':'Atlanta Braves',
    'Baltimore':'Baltimore Orioles','Boston':'Boston Red Sox',
    'Chicago Cubs':'Chicago Cubs','Chicago White Sox':'Chicago White Sox',
    'Cubs':'Chicago Cubs','White Sox':'Chicago White Sox',
    'Cincinnati':'Cincinnati Reds','Cleveland':'Cleveland Guardians',
    'Colorado':'Colorado Rockies','Detroit':'Detroit Tigers',
    'Houston':'Houston Astros','Kansas City':'Kansas City Royals',
    'Los Angeles Angels':'Los Angeles Angels','LA Angels':'Los Angeles Angels','Angels':'Los Angeles Angels',
    'Los Angeles Dodgers':'Los Angeles Dodgers','LA Dodgers':'Los Angeles Dodgers','Dodgers':'Los Angeles Dodgers',
    // Kalshi single-letter disambiguators
    'Los Angeles A':'Los Angeles Angels','Los Angeles D':'Los Angeles Dodgers',
    'New York M':'New York Mets','New York Y':'New York Yankees',
    'Chicago C':'Chicago Cubs','Chicago WS':'Chicago White Sox',
    'Miami':'Miami Marlins','Milwaukee':'Milwaukee Brewers',
    'Minnesota':'Minnesota Twins',
    'New York Mets':'New York Mets','New York Yankees':'New York Yankees',
    'Mets':'New York Mets','Yankees':'New York Yankees',
    'NY Mets':'New York Mets','NY Yankees':'New York Yankees',
    'Oakland':'Oakland Athletics','Athletics':'Athletics','A\'s':'Athletics',
    'Philadelphia':'Philadelphia Phillies','Pittsburgh':'Pittsburgh Pirates',
    'San Diego':'San Diego Padres','San Francisco':'San Francisco Giants',
    'Seattle':'Seattle Mariners','St. Louis':'St. Louis Cardinals',
    'Tampa Bay':'Tampa Bay Rays','Texas':'Texas Rangers',
    'Toronto':'Toronto Blue Jays','Washington':'Washington Nationals',
  },
  nhl: {
    'Anaheim':'Anaheim Ducks','Boston':'Boston Bruins',
    'Buffalo':'Buffalo Sabres','Calgary':'Calgary Flames',
    'Carolina':'Carolina Hurricanes','Chicago':'Chicago Blackhawks',
    'Colorado':'Colorado Avalanche','Columbus':'Columbus Blue Jackets',
    'Dallas':'Dallas Stars','Detroit':'Detroit Red Wings',
    'Edmonton':'Edmonton Oilers','Florida':'Florida Panthers',
    'Los Angeles':'Los Angeles Kings','LA Kings':'Los Angeles Kings','Kings':'Los Angeles Kings',
    // Kalshi single-letter disambiguators (NY has 3 teams — I/R for hockey)
    'Los Angeles K':'Los Angeles Kings','New York I':'New York Islanders',
    'New York R':'New York Rangers',
    'Minnesota':'Minnesota Wild','Montreal':'Montreal Canadiens',
    'Nashville':'Nashville Predators','New Jersey':'New Jersey Devils',
    'NY Islanders':'New York Islanders','NY Rangers':'New York Rangers',
    'Islanders':'New York Islanders','Rangers':'New York Rangers',
    'Ottawa':'Ottawa Senators','Philadelphia':'Philadelphia Flyers',
    'Pittsburgh':'Pittsburgh Penguins','San Jose':'San Jose Sharks',
    'Seattle':'Seattle Kraken','St. Louis':'St. Louis Blues',
    'Tampa Bay':'Tampa Bay Lightning','Toronto':'Toronto Maple Leafs',
    'Utah':'Utah Hockey Club','Vancouver':'Vancouver Canucks',
    'Vegas':'Vegas Golden Knights','Washington':'Washington Capitals',
    'Winnipeg':'Winnipeg Jets',
    // Nicknames — used as second-pass lookup when yes_sub_title ships
    // as "{ABBR} {Nickname}" like "EDM Oilers".
    'Ducks':'Anaheim Ducks','Bruins':'Boston Bruins','Sabres':'Buffalo Sabres',
    'Flames':'Calgary Flames','Hurricanes':'Carolina Hurricanes',
    'Blackhawks':'Chicago Blackhawks','Avalanche':'Colorado Avalanche',
    'Blue Jackets':'Columbus Blue Jackets','Stars':'Dallas Stars',
    'Red Wings':'Detroit Red Wings','Oilers':'Edmonton Oilers',
    'Panthers':'Florida Panthers','Wild':'Minnesota Wild',
    'Canadiens':'Montreal Canadiens','Predators':'Nashville Predators',
    'Devils':'New Jersey Devils','Senators':'Ottawa Senators',
    'Flyers':'Philadelphia Flyers','Penguins':'Pittsburgh Penguins',
    'Sharks':'San Jose Sharks','Kraken':'Seattle Kraken',
    'Blues':'St. Louis Blues','Lightning':'Tampa Bay Lightning',
    'Maple Leafs':'Toronto Maple Leafs','Hockey Club':'Utah Hockey Club',
    'Canucks':'Vancouver Canucks','Golden Knights':'Vegas Golden Knights',
    'Capitals':'Washington Capitals','Jets':'Winnipeg Jets',
  },
  nfl: {},
}

function seriesToSport(series: string): Sport | null {
  if (series === 'KXNBAGAME') return 'nba'
  if (series === 'KXMLBGAME') return 'mlb'
  if (series === 'KXNHLGAME') return 'nhl'
  if (series === 'KXNFLGAME') return 'nfl'
  return null
}

function resolveFullName(sport: Sport, cityOrName: string): string {
  const s = cityOrName.trim()
  const direct = CITY_MAPS[sport][s]
  if (direct) return direct
  // NHL fallback: yes_sub_title ships as "{ABBR} {Nickname}" like
  // "EDM Oilers" or "LA Kings". Try the nickname-only lookup (last
  // word onwards) as a second pass.
  if (sport === 'nhl') {
    const parts = s.split(/\s+/)
    if (parts.length >= 2) {
      const nickname = parts.slice(1).join(' ')
      const nick = CITY_MAPS.nhl[nickname]
      if (nick) return nick
    }
  }
  return s
}

/** Parse a Kalshi game-market title. Three observed formats:
 *    NBA / NHL: "Game 4: Oklahoma City at Phoenix Winner?" (playoff " at ")
 *    MLB:       "Pittsburgh vs Milwaukee Winner?"           (" vs ")
 *    NBA (reg): "Lakers at Suns Winner?"                    (" at ")
 *  Returns {awayCity, homeCity} — for " at " the left side is the visitor,
 *  for " vs " the left side is the home team (Kalshi convention). */
function parseGameTitle(title: string): { away: string; home: string } | null {
  const core = title.replace(/^Game\s+\d+:\s*/i, '').replace(/\s*Winner\?\s*$/i, '').trim()
  const atIdx = core.search(/\s+at\s+/i)
  if (atIdx > 0) {
    const away = core.slice(0, atIdx).trim()
    const home = core.slice(atIdx).replace(/^\s+at\s+/i, '').trim()
    if (away && home) return { away, home }
  }
  const vsIdx = core.search(/\s+vs\.?\s+/i)
  if (vsIdx > 0) {
    // Kalshi MLB format: "Home vs Away Winner?"
    const home = core.slice(0, vsIdx).trim()
    const away = core.slice(vsIdx).replace(/^\s+vs\.?\s+/i, '').trim()
    if (away && home) return { away, home }
  }
  return null
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', 'kalshi')
    .single()

  if (!source) {
    return NextResponse.json({ error: 'Kalshi source not found in DB' }, { status: 500 })
  }

  let fetchResult
  try {
    fetchResult = await fetchKalshiMarkets()
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const { markets, debug } = fetchResult

  // Upcoming events needed for moneyline matching.
  // Include leagues(slug) so we can auto-create missing events under the
  // correct league_id.
  const nowIso = new Date().toISOString()
  const { data: events } = await db
    .from('events')
    .select('id, title, start_time, status, league_id, leagues(slug)')
    .in('status', ['scheduled', 'live'])

  // League slug → league_id for auto-creation of events Kalshi lists but
  // no sportsbook adapter has posted yet (common: future playoff games).
  const leagueIdBySlug = new Map<string, string>()
  {
    const { data: leagues } = await db.from('leagues').select('id, slug')
    for (const l of (leagues ?? []) as any[]) leagueIdBySlug.set(l.slug, l.id)
  }

  const SPORT_TO_LEAGUE_SLUG: Record<Sport, string> = {
    nba: 'nba', mlb: 'mlb', nhl: 'nhl', nfl: 'nfl',
  }

  const now = new Date().toISOString()
  const predSnapshots: object[] = []

  // Group game-winner markets by ticker prefix (everything before the
  // last "-{TEAM}" segment). Kalshi ships TWO markets per game — one for
  // each team winning — so we pair them to build a single moneyline row.
  type GamePair = {
    ticker: string
    seriesTicker: string           // e.g. "KXNBAGAME"
    a?: KalshiMarket               // first market seen
    b?: KalshiMarket               // second market seen
  }
  const gamePairs = new Map<string, GamePair>()

  for (const market of markets) {
    const yesProb = kalshiPriceToProb(market, 'yes')
    const noProb = kalshiPriceToProb(market, 'no')

    const titleWords = market.title.toLowerCase().split(/\s+/)
    const matchedPred = events?.find(e => {
      const eventWords = e.title.toLowerCase().split(/\s+/)
      const overlap = titleWords.filter((w: string) => w.length > 3 && eventWords.includes(w))
      return overlap.length >= 2
    })

    predSnapshots.push({
      event_id: matchedPred?.id ?? null,
      source_id: source.id,
      contract_title: market.title,
      external_contract_id: market.ticker,
      yes_price: yesProb,
      no_price: noProb,
      total_volume: market.volume,
      open_interest: market.open_interest,
      snapshot_time: now,
    })

    // Game-winner series (KXNBAGAME/KXMLBGAME/KXNHLGAME/KXNFLGAME) get
    // paired into a moneyline that flows into market_snapshots so it
    // shows up on Markets / EV / Arb.
    const series = market.ticker.split('-')[0]
    if (!/^KX(NBA|MLB|NHL|NFL)GAME$/.test(series)) continue

    const lastDash = market.ticker.lastIndexOf('-')
    const tickerPrefix = market.ticker.slice(0, lastDash)
    const pair = gamePairs.get(tickerPrefix) ?? { ticker: tickerPrefix, seriesTicker: series }
    if (!pair.a) pair.a = market
    else pair.b = market
    gamePairs.set(tickerPrefix, pair)
  }

  // Build moneyline snapshots from paired game markets.
  const marketSnapshots: object[] = []
  let pairedMoneylines = 0
  let pairedUnmatchedEvent = 0
  let pairedUnmatchedTeam = 0
  let eventsCreated = 0
  for (const pair of gamePairs.values()) {
    if (!pair.a || !pair.b) continue
    const sport = seriesToSport(pair.seriesTicker)
    if (!sport) { pairedUnmatchedTeam++; continue }
    const parsed = parseGameTitle(pair.a.title)
    if (!parsed) { pairedUnmatchedTeam++; continue }
    const awayFull = resolveFullName(sport, parsed.away)
    const homeFull = resolveFullName(sport, parsed.home)

    // Find the canonical event. Match on sorted team-pair within the
    // vs-split title, regardless of home/away order in Kalshi's title.
    const pairKey = [awayFull.toLowerCase(), homeFull.toLowerCase()].sort().join('|')
    let dbEvent: any = (events ?? []).find((e: any) => {
      const parts = (e.title as string).split(/\s+vs\.?\s+/i)
      if (parts.length !== 2) return false
      return [parts[0].trim().toLowerCase(), parts[1].trim().toLowerCase()].sort().join('|') === pairKey
    })

    // Kalshi-only auto-create DISABLED. Kalshi lists contingent future
    // playoff games (Game 5/6/7) with close_time set weeks out — most
    // never get played if a series ends earlier. Auto-creating those
    // surfaced phantom "Detroit Pistons vs Orlando Magic — May 9" rows
    // on the Markets page with no other book and a dead detail link.
    //
    // Policy now: only write Kalshi moneylines for events already in the
    // canonical events table (put there by sportsbook adapters). Unmatched
    // Kalshi games are silently skipped; once a sportsbook posts them
    // closer to game time, the next Kalshi fire matches and inserts odds.
    if (!dbEvent) { pairedUnmatchedEvent++; continue }

    // Map each Kalshi contract to home or away using the CANONICAL DB
    // event's title, NOT Kalshi's own parsed home. Kalshi uses
    // "Home vs Away" convention but its "home" often disagrees with the
    // DB event's home (e.g. DB title = "Los Angeles Dodgers vs Chicago
    // Cubs" has home=Dodgers; Kalshi title = "Chicago vs Los Angeles"
    // has home=Cubs). Keying on Kalshi's home flipped every Kalshi
    // moneyline relative to every other book — producing phantom
    // arbitrage at ~21-26% profit on any slightly-off matchup.
    const dbTitleParts = (dbEvent.title as string).split(/\s+vs\.?\s+/i)
    const dbHomeLower = (dbTitleParts[0] ?? '').trim().toLowerCase()
    const aSub = ((pair.a as any).yes_sub_title ?? '').trim()
    const bSub = ((pair.b as any).yes_sub_title ?? '').trim()
    const aFull = resolveFullName(sport, aSub).toLowerCase()
    const bFull = resolveFullName(sport, bSub).toLowerCase()

    const aIsDbHome = aFull === dbHomeLower || dbHomeLower.includes(aFull) || aFull.includes(dbHomeLower)
    const bIsDbHome = bFull === dbHomeLower || dbHomeLower.includes(bFull) || bFull.includes(dbHomeLower)
    if (aIsDbHome === bIsDbHome) { pairedUnmatchedTeam++; continue }

    const homeMarket = aIsDbHome ? pair.a : pair.b
    const awayMarket = aIsDbHome ? pair.b : pair.a
    const homeProb = kalshiPriceToProb(homeMarket, 'yes')
    const awayProb = kalshiPriceToProb(awayMarket, 'yes')
    const homePrice = probToAmerican(homeProb)
    const awayPrice = probToAmerican(awayProb)
    if (homePrice == null && awayPrice == null) continue

    marketSnapshots.push({
      event_id: dbEvent.id,
      source_id: source.id,
      market_type: 'moneyline',
      home_price: homePrice,
      away_price: awayPrice,
      home_implied_prob: homeProb > 0 && homeProb < 1 ? round4(homeProb) : null,
      away_implied_prob: awayProb > 0 && awayProb < 1 ? round4(awayProb) : null,
      snapshot_time: now,
    })
    pairedMoneylines++
  }

  // Wipe stale Kalshi market_snapshots to avoid duplicate moneyline rows
  // piling up each cycle. (Polymarket does the same.)
  await db.from('market_snapshots').delete().eq('source_id', source.id)

  // Insert prediction snapshots (chunks of 200)
  let predInserted = 0
  const errors: string[] = []
  for (let i = 0; i < predSnapshots.length; i += 200) {
    const { error } = await db
      .from('prediction_market_snapshots')
      .insert(predSnapshots.slice(i, i + 200))
    if (error) errors.push(`pred batch ${Math.floor(i / 200)}: ${error.message}`)
    else predInserted += Math.min(200, predSnapshots.length - i)
  }

  // Insert moneyline market snapshots (history / audit log)
  let marketInserted = 0
  for (let i = 0; i < marketSnapshots.length; i += 200) {
    const { error } = await db
      .from('market_snapshots')
      .insert(marketSnapshots.slice(i, i + 200))
    if (error) errors.push(`market batch ${Math.floor(i / 200)}: ${error.message}`)
    else marketInserted += Math.min(200, marketSnapshots.length - i)
  }

  // Also upsert into current_market_odds — this is what Markets / EV /
  // Arb pages actually READ from. Writing only to market_snapshots leaves
  // the live UI empty.
  // Dedupe by (event_id, source_id, market_type, line_value) before upsert —
  // Postgres rejects batches that would "affect a row a second time".
  // Kalshi can produce duplicate rows when Game 4 and Game 5 of the same
  // series are both listed and resolve to the same canonical event.
  const dedupKey = (r: any) => `${r.event_id}|${r.source_id}|${r.market_type}|${r.line_value ?? 'null'}`
  const dedupedCurrent = new Map<string, any>()
  for (const s of marketSnapshots as any[]) {
    const oddsHash = [s.home_price, s.away_price, null, null, null, null, null]
      .map(v => v ?? '').join('|')
    const row = {
      event_id: s.event_id,
      source_id: s.source_id,
      market_type: s.market_type,
      line_value: 0,
      odds_hash: oddsHash,
      home_price: s.home_price,
      away_price: s.away_price,
      draw_price: null,
      spread_value: null,
      total_value: null,
      over_price: null,
      under_price: null,
      home_implied_prob: s.home_implied_prob,
      away_implied_prob: s.away_implied_prob,
      movement_direction: 'flat',
      snapshot_time: now,
      changed_at: now,
    }
    dedupedCurrent.set(dedupKey(row), row)
  }
  const currentOddsRows = [...dedupedCurrent.values()]
  let currentOddsUpserted = 0
  for (let i = 0; i < currentOddsRows.length; i += 200) {
    const { error } = await db
      .from('current_market_odds')
      .upsert(currentOddsRows.slice(i, i + 200), {
        onConflict: 'event_id,source_id,market_type,line_value',
      })
    if (error) errors.push(`current_market_odds upsert batch ${Math.floor(i / 200)}: ${error.message}`)
    else currentOddsUpserted += Math.min(200, currentOddsRows.length - i)
  }

  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now })
    .eq('slug', 'kalshi')

  return NextResponse.json({
    ok: true,
    marketsFound: predSnapshots.length,
    marketsInserted: predInserted,
    moneylinesBuilt: pairedMoneylines,
    moneylinesInserted: marketInserted,
    currentOddsUpserted,
    eventsCreated,
    pairedUnmatchedEvent,
    pairedUnmatchedTeam,
    debug,
    errors: errors.length ? errors : undefined,
  })
}
