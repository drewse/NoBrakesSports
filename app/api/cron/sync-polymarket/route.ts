import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPolymarketEvents, parsePolymarketPrices } from '@/lib/data-sync/polymarket'

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

// Convert implied probability (0–1) to American odds
function probToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0
  if (prob >= 0.5) return Math.round(-(prob / (1 - prob)) * 100)
  return Math.round(((1 - prob) / prob) * 100)
}

// Strip sport prefixes, normalize "vs", lowercase
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(nba|nfl|mlb|nhl|mls|nba\s*playoffs?|nfl\s*playoffs?)[\s:–-]+/i, '')
    .replace(/\s+vs\.?\s+/i, ' vs ')
    .trim()
}

// Return true if Polymarket event title and DB event title refer to the same game
function titlesMatch(dbTitle: string, polyTitle: string): boolean {
  const db = normalizeTitle(dbTitle)
  const poly = normalizeTitle(polyTitle)
  if (db === poly) return true
  // Fall back: check that ≥2 significant words (>3 chars, not "vs") overlap
  const dbWords = db.split(/\s+/).filter(w => w.length > 3 && w !== 'vs')
  const polySet = new Set(poly.split(/\s+/).filter(w => w.length > 3 && w !== 'vs'))
  return dbWords.filter(w => polySet.has(w)).length >= 2
}

// Detect whether a market question refers to the home or away team.
// Returns 'home' | 'away' | null if ambiguous.
function detectSide(
  question: string,
  homeTeam: string,
  awayTeam: string,
): 'home' | 'away' | null {
  const q = question.toLowerCase()
  const sig = (name: string) => name.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  const homeMatches = sig(homeTeam).filter(w => q.includes(w)).length
  const awayMatches = sig(awayTeam).filter(w => q.includes(w)).length
  if (homeMatches > awayMatches) return 'home'
  if (awayMatches > homeMatches) return 'away'
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
    .eq('slug', 'polymarket')
    .single()

  if (!source) {
    return NextResponse.json({ error: 'Polymarket source not found in DB' }, { status: 500 })
  }

  let polyEvents
  try {
    polyEvents = await fetchPolymarketEvents()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  // Only match against upcoming events
  const now = new Date().toISOString()
  const { data: dbEvents } = await db
    .from('events')
    .select('id, title, start_time')
    .gt('start_time', now)

  const predSnapshots: object[] = []
  const marketSnapshots: object[] = []
  let skippedInactive = 0
  let skippedNoPrices = 0
  let skippedNoMarkets = 0
  let matchedToEvent = 0

  for (const polyEvent of polyEvents) {
    if (!polyEvent.markets?.length) { skippedNoMarkets++; continue }

    // Match at the event level using the Polymarket event title
    const dbEvent = dbEvents?.find(e => titlesMatch(e.title, polyEvent.title)) ?? null

    // Parse home/away teams from the DB event title ("Home vs Away")
    let homeTeam: string | null = null
    let awayTeam: string | null = null
    if (dbEvent) {
      const parts = dbEvent.title.split(/\s+vs\.?\s+/i)
      if (parts.length === 2) {
        homeTeam = parts[0].trim()
        awayTeam = parts[1].trim()
      }
    }

    for (const market of polyEvent.markets) {
      if (!market.active || market.closed) { skippedInactive++; continue }

      const prices = parsePolymarketPrices(market)
      if (!prices) { skippedNoPrices++; continue }

      const volume = parseFloat(market.volume ?? '0')

      // Always insert into prediction_market_snapshots for the Pred. Markets page
      predSnapshots.push({
        event_id: dbEvent?.id ?? null,
        source_id: source.id,
        contract_title: market.question,
        external_contract_id: market.conditionId,
        yes_price: prices.yes,
        no_price: prices.no,
        total_volume: isNaN(volume) ? null : volume,
        snapshot_time: now,
      })

      // If matched to an event, also insert into market_snapshots so it flows
      // into Top EV Lines and Arbitrage alongside sportsbook data
      if (dbEvent && homeTeam && awayTeam) {
        const side = detectSide(market.question, homeTeam, awayTeam)
        if (side) {
          const subjectAmerican = probToAmerican(prices.yes)
          const otherAmerican = probToAmerican(prices.no)
          const homeAmerican = side === 'home' ? subjectAmerican : otherAmerican
          const awayAmerican = side === 'away' ? subjectAmerican : otherAmerican
          const homeProb = side === 'home' ? prices.yes : prices.no
          const awayProb = side === 'away' ? prices.yes : prices.no

          marketSnapshots.push({
            event_id: dbEvent.id,
            source_id: source.id,
            market_type: 'moneyline',
            home_price: homeAmerican,
            away_price: awayAmerican,
            home_implied_prob: homeProb,
            away_implied_prob: awayProb,
            snapshot_time: now,
          })
          matchedToEvent++
        }
      }
    }
  }

  // Bulk insert prediction_market_snapshots in chunks of 200
  let predInserted = 0
  const errors: string[] = []
  for (let i = 0; i < predSnapshots.length; i += 200) {
    const { error } = await db
      .from('prediction_market_snapshots')
      .insert(predSnapshots.slice(i, i + 200))
    if (error) errors.push(`pred batch ${Math.floor(i / 200)}: ${error.message}`)
    else predInserted += Math.min(200, predSnapshots.length - i)
  }

  // Bulk insert market_snapshots in chunks of 200
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
    .eq('slug', 'polymarket')

  return NextResponse.json({
    ok: true,
    eventsFound: polyEvents.length,
    marketsProcessed: predSnapshots.length,
    predInserted,
    marketSnapshotsInserted: marketInserted,
    matchedToSportsbookEvent: matchedToEvent,
    skippedNoMarkets,
    skippedInactive,
    skippedNoPrices,
    errors: errors.length ? errors : undefined,
    debug: {
      samplePolyTitles: polyEvents.slice(0, 10).map(e => e.title),
      sampleDbTitles: (dbEvents ?? []).slice(0, 10).map(e => e.title),
    },
  })
}
