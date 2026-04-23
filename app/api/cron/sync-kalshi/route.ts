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
const CITY_TO_FULL: Record<string, string> = {
  // NBA
  'Atlanta':'Atlanta Hawks', 'Boston':'Boston Celtics', 'Brooklyn':'Brooklyn Nets',
  'Charlotte':'Charlotte Hornets', 'Chicago':'Chicago Bulls',
  'Cleveland':'Cleveland Cavaliers', 'Dallas':'Dallas Mavericks',
  'Denver':'Denver Nuggets', 'Detroit':'Detroit Pistons',
  'Golden State':'Golden State Warriors', 'Houston':'Houston Rockets',
  'Indiana':'Indiana Pacers', 'LA Clippers':'LA Clippers',
  'Los Angeles Lakers':'Los Angeles Lakers', 'LA Lakers':'Los Angeles Lakers',
  'Memphis':'Memphis Grizzlies', 'Miami':'Miami Heat',
  'Milwaukee':'Milwaukee Bucks', 'Minnesota':'Minnesota Timberwolves',
  'New Orleans':'New Orleans Pelicans', 'New York':'New York Knicks',
  'Oklahoma City':'Oklahoma City Thunder', 'Orlando':'Orlando Magic',
  'Philadelphia':'Philadelphia 76ers', 'Phoenix':'Phoenix Suns',
  'Portland':'Portland Trail Blazers', 'Sacramento':'Sacramento Kings',
  'San Antonio':'San Antonio Spurs', 'Toronto':'Toronto Raptors',
  'Utah':'Utah Jazz', 'Washington':'Washington Wizards',
  // MLB (cities alone are usually ambiguous, but Kalshi uses the city
  // scoped by the series, so same map works — overridden per-sport below)
  'Arizona':'Arizona Diamondbacks', 'Baltimore':'Baltimore Orioles',
  'Chicago Cubs':'Chicago Cubs', 'Chicago White Sox':'Chicago White Sox',
  'Cincinnati':'Cincinnati Reds', 'Colorado':'Colorado Rockies',
  'Kansas City':'Kansas City Royals', 'Los Angeles Angels':'Los Angeles Angels',
  'Los Angeles Dodgers':'Los Angeles Dodgers', 'Miami Marlins':'Miami Marlins',
  'Milwaukee Brewers':'Milwaukee Brewers', 'Minnesota Twins':'Minnesota Twins',
  'New York Mets':'New York Mets', 'New York Yankees':'New York Yankees',
  'Oakland':'Oakland Athletics', 'Athletics':'Athletics',
  'Pittsburgh':'Pittsburgh Pirates', 'San Diego':'San Diego Padres',
  'Seattle':'Seattle Mariners', 'San Francisco':'San Francisco Giants',
  'St. Louis':'St. Louis Cardinals', 'Tampa Bay':'Tampa Bay Rays',
  'Texas':'Texas Rangers', 'Washington Nationals':'Washington Nationals',
  // NHL
  'Anaheim':'Anaheim Ducks', 'Buffalo':'Buffalo Sabres',
  'Calgary':'Calgary Flames', 'Carolina':'Carolina Hurricanes',
  'Columbus':'Columbus Blue Jackets', 'Edmonton':'Edmonton Oilers',
  'Florida':'Florida Panthers', 'Montreal':'Montreal Canadiens',
  'Nashville':'Nashville Predators', 'New Jersey':'New Jersey Devils',
  'NY Islanders':'New York Islanders', 'NY Rangers':'New York Rangers',
  'Ottawa':'Ottawa Senators', 'Vancouver':'Vancouver Canucks',
  'Vegas':'Vegas Golden Knights', 'Winnipeg':'Winnipeg Jets',
  'San Jose':'San Jose Sharks', 'Philadelphia Flyers':'Philadelphia Flyers',
  'Pittsburgh Penguins':'Pittsburgh Penguins', 'Tampa Bay Lightning':'Tampa Bay Lightning',
  'St. Louis Blues':'St. Louis Blues',
}

function resolveFullName(cityOrName: string): string {
  const s = cityOrName.trim()
  return CITY_TO_FULL[s] ?? s
}

/** Parse a Kalshi game-market title like "Game 4: Oklahoma City at Phoenix
 *  Winner?" → {awayCity, homeCity}. Falls back null on unexpected formats. */
function parseGameTitle(title: string): { away: string; home: string } | null {
  // Strip the "Game N:" prefix if present, then split on " at " / " vs. " / " vs ".
  const core = title.replace(/^Game\s+\d+:\s*/i, '').replace(/\s*Winner\?\s*$/i, '').trim()
  const atIdx = core.search(/\s+at\s+/i)
  if (atIdx > 0) {
    const away = core.slice(0, atIdx).trim()
    const home = core.slice(atIdx).replace(/^\s+at\s+/i, '').trim()
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
  const nowIso = new Date().toISOString()
  const { data: events } = await db
    .from('events')
    .select('id, title, start_time, status')
    .in('status', ['scheduled', 'live'])

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
  for (const pair of gamePairs.values()) {
    if (!pair.a || !pair.b) continue
    const parsed = parseGameTitle(pair.a.title)
    if (!parsed) { pairedUnmatchedTeam++; continue }
    const awayFull = resolveFullName(parsed.away)
    const homeFull = resolveFullName(parsed.home)

    // Find the canonical event. Match on sorted team-pair within the
    // vs-split title, regardless of home/away order in Kalshi's title.
    const pairKey = [awayFull.toLowerCase(), homeFull.toLowerCase()].sort().join('|')
    const dbEvent = events?.find((e: any) => {
      const parts = (e.title as string).split(/\s+vs\.?\s+/i)
      if (parts.length !== 2) return false
      return [parts[0].trim().toLowerCase(), parts[1].trim().toLowerCase()].sort().join('|') === pairKey
    })
    if (!dbEvent) { pairedUnmatchedEvent++; continue }

    // Map each Kalshi contract to home or away via yes_sub_title.
    const aSub = ((pair.a as any).yes_sub_title ?? '').trim()
    const bSub = ((pair.b as any).yes_sub_title ?? '').trim()
    const aFull = resolveFullName(aSub)
    const bFull = resolveFullName(bSub)

    const aIsHome = aFull.toLowerCase() === homeFull.toLowerCase()
    const bIsHome = bFull.toLowerCase() === homeFull.toLowerCase()
    if (aIsHome === bIsHome) { pairedUnmatchedTeam++; continue }

    const homeMarket = aIsHome ? pair.a : pair.b
    const awayMarket = aIsHome ? pair.b : pair.a
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

  // Insert moneyline market snapshots
  let marketInserted = 0
  for (let i = 0; i < marketSnapshots.length; i += 200) {
    const { error } = await db
      .from('market_snapshots')
      .insert(marketSnapshots.slice(i, i + 200))
    if (error) errors.push(`market batch ${Math.floor(i / 200)}: ${error.message}`)
    else marketInserted += Math.min(200, marketSnapshots.length - i)
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
    pairedUnmatchedEvent,
    pairedUnmatchedTeam,
    debug,
    errors: errors.length ? errors : undefined,
  })
}
