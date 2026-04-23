import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPolymarketEvents, parsePolymarketPrices } from '@/lib/data-sync/polymarket'

/** Parse a Polymarket per-game moneyline market where outcomes are team
 *  names rather than ["Yes","No"]. Returns {homePrice, awayPrice} in
 *  American odds or null if the outcomes don't match the home/away team
 *  names or prices are malformed.  */
function parseTeamOutcomeMoneyline(
  market: any,
  homeTeam: string,
  awayTeam: string,
): { homeProb: number; awayProb: number } | null {
  try {
    const rawOutcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : market.outcomes
    const rawPrices = typeof market.outcomePrices === 'string' ? JSON.parse(market.outcomePrices) : market.outcomePrices
    if (!Array.isArray(rawOutcomes) || !Array.isArray(rawPrices)) return null
    if (rawOutcomes.length !== 2 || rawPrices.length !== 2) return null

    // Match each outcome to home or away by checking whether any
    // significant word of the team name appears in the outcome label
    // (case-insensitive). "Rays" → "Tampa Bay Rays". "Red Sox" →
    // "Boston Red Sox".
    const sig = (name: string) => name.toLowerCase().split(/\s+/).filter(w => w.length > 2)
    const homeSig = sig(homeTeam)
    const awaySig = sig(awayTeam)

    function whichSide(label: string): 'home' | 'away' | null {
      const l = label.toLowerCase()
      const hHit = homeSig.filter(w => l.includes(w)).length
      const aHit = awaySig.filter(w => l.includes(w)).length
      if (hHit > aHit) return 'home'
      if (aHit > hHit) return 'away'
      return null
    }

    const side0 = whichSide(String(rawOutcomes[0]))
    const side1 = whichSide(String(rawOutcomes[1]))
    if (side0 === null || side1 === null || side0 === side1) return null

    const p0 = parseFloat(String(rawPrices[0]))
    const p1 = parseFloat(String(rawPrices[1]))
    if (!isFinite(p0) || !isFinite(p1)) return null

    const homeProb = side0 === 'home' ? p0 : p1
    const awayProb = side0 === 'away' ? p0 : p1
    return { homeProb, awayProb }
  } catch {
    return null
  }
}

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

// Return true if Polymarket event title and DB event title refer to the same game.
// When both titles have "vs", we match each team against the CORRECT side of the
// opponent's "vs" (allowing home/away swap). This prevents city-name collisions
// like "Orlando Storm vs Columbus Aviators" matching "Columbus Crew vs Orlando City"
// because "Orlando" and "Columbus" appear on different sides.
function titlesMatch(dbTitle: string, polyTitle: string): boolean {
  const db = normalizeTitle(dbTitle)
  const poly = normalizeTitle(polyTitle)
  if (db === poly) return true

  const dbParts = db.split(' vs ')
  if (dbParts.length !== 2) return false
  const [dbHome, dbAway] = dbParts

  const sigWords = (name: string) => name.split(/\s+/).filter(w => w.length > 3)

  const polyParts = poly.split(' vs ')
  if (polyParts.length === 2) {
    // Both titles have "vs" — match sides directionally, allow home/away swap
    const [polyHome, polyAway] = polyParts
    const straightMatch =
      sigWords(dbHome).some(w => polyHome.includes(w)) &&
      sigWords(dbAway).some(w => polyAway.includes(w))
    const swapMatch =
      sigWords(dbHome).some(w => polyAway.includes(w)) &&
      sigWords(dbAway).some(w => polyHome.includes(w))
    return straightMatch || swapMatch
  }

  // Poly title has no "vs" (e.g. "Will the Lakers win?") — fall back to
  // requiring both teams' words to appear somewhere in the title
  const homeMatch = sigWords(dbHome).some(w => poly.includes(w))
  const awayMatch = sigWords(dbAway).some(w => poly.includes(w))
  return homeMatch && awayMatch
}

// Only consider markets that are asking about a team winning — skip prop-style
// questions ("score first", "win by 2+", "advance", etc.) which create noise.
function isWinMarket(question: string): boolean {
  return /\b(win|wins|beat|beats|defeat|defeats)\b/i.test(question)
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
    .select('id, title, start_time, leagues(slug)')
    .gt('start_time', now)

  // Clear stale Polymarket data from both tables before inserting fresh rows.
  // Polymarket prices change every sync — old rows cause duplicate chips and fake arb.
  await db.from('market_snapshots').delete().eq('source_id', source.id)
  await db.from('prediction_market_snapshots').delete().eq('source_id', source.id)

  const predSnapshots: object[] = []
  const marketSnapshots: object[] = []
  let skippedInactive = 0
  let skippedNoPrices = 0
  let skippedNoMarkets = 0
  let matchedToEvent = 0
  let eventsWithVs = 0            // poly events with 'X vs Y' pattern
  let eventsMatchedDb = 0         // poly events that matched a DB event
  let teamOutcomeParsed = 0       // markets where team-outcome parser worked
  let teamOutcomeFailed = 0       // markets where team-outcome parser returned null
  // Per-league breakdown of inserted moneylines (helps diagnose when
  // user says "Polymarket has NBA games but I don't see them on Markets").
  const insertedByLeague: Record<string, number> = {}
  const sampleInsertedTitles: string[] = []  // first 10 titles for eyeball

  // Track which events already have a market_snapshot from Polymarket this run.
  // Polymarket has many binary markets per game — we only want ONE row per event.
  const insertedEventIds = new Set<string>()

  // Map poly tag slugs to our DB league slug(s). Events in pool below only
  // match DB events whose league slug is in the allowed set for that sport.
  // Without this, the loose titlesMatch word-overlap check produces huge
  // false positives like matching "Clemson Tigers vs. Western Carolina" →
  // "Willetton Tigers vs South West Slammers" (Australian NBL) on the word
  // "tigers".
  const POLY_TAG_TO_LEAGUES: Record<string, string[]> = {
    nba:        ['nba'],
    basketball: ['nba','wnba'],
    mlb:        ['mlb'],
    baseball:   ['mlb'],
    nhl:        ['nhl'],
    hockey:     ['nhl'],
    nfl:        ['nfl'],
    football:   ['nfl'],  // American football only for this mapping; soccer
                          // uses other tag labels ("soccer","epl","laliga"...)
    soccer:     ['epl','laliga','bundesliga','seria_a','ligue_one','mls','liga_mx','copa_libertadores','copa_sudamericana','eredivisie','liga_portugal','spl','ucl'],
    epl:        ['epl'],
    mls:        ['mls'],
  }

  function allowedDbLeaguesForPolyEvent(polyEv: any): Set<string> | null {
    const tags: string[] = (polyEv.tags ?? []).map((t: any) => t.slug).filter(Boolean)
    const allowed = new Set<string>()
    for (const t of tags) {
      const lgs = POLY_TAG_TO_LEAGUES[t]
      if (lgs) for (const l of lgs) allowed.add(l)
    }
    // No sport tag → no sport restriction. (Lets rare edge cases through;
    // the strict titlesMatch still filters most noise.)
    return allowed.size > 0 ? allowed : null
  }

  for (const polyEvent of polyEvents) {
    if (!polyEvent.markets?.length) { skippedNoMarkets++; continue }
    if (polyEvent.title && /\s+vs\.?\s+/i.test(polyEvent.title)) eventsWithVs++

    // Sport-aware matching: if the poly event is tagged with a sport we
    // recognize, only consider DB events in the allowed league set.
    const allowedLeagues = allowedDbLeaguesForPolyEvent(polyEvent)
    const dbEvent = dbEvents?.find((e: any) => {
      if (allowedLeagues && !allowedLeagues.has(e.leagues?.slug)) return false
      return titlesMatch(e.title, polyEvent.title)
    }) ?? null
    if (dbEvent) eventsMatchedDb++

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

      // Try the Yes/No shape first (futures / "Will X win the season?" style).
      // Fall back to the team-name outcome shape (per-game moneyline — the
      // most common format for NBA/MLB/NHL per-game Polymarket events).
      const yesNoPrices = parsePolymarketPrices(market)

      const volume = parseFloat(market.volume ?? '0')

      if (yesNoPrices) {
        predSnapshots.push({
          event_id: dbEvent?.id ?? null,
          source_id: source.id,
          contract_title: market.question,
          external_contract_id: market.conditionId,
          yes_price: yesNoPrices.yes,
          no_price: yesNoPrices.no,
          total_volume: isNaN(volume) ? null : volume,
          snapshot_time: now,
        })

        if (
          dbEvent && homeTeam && awayTeam &&
          !insertedEventIds.has(dbEvent.id) &&
          isWinMarket(market.question)
        ) {
          const side = detectSide(market.question, homeTeam, awayTeam)
          if (side) {
            const subjectAmerican = probToAmerican(yesNoPrices.yes)
            const otherAmerican = probToAmerican(yesNoPrices.no)
            marketSnapshots.push({
              event_id: dbEvent.id,
              source_id: source.id,
              market_type: 'moneyline',
              home_price: side === 'home' ? subjectAmerican : otherAmerican,
              away_price: side === 'away' ? subjectAmerican : otherAmerican,
              home_implied_prob: side === 'home' ? yesNoPrices.yes : yesNoPrices.no,
              away_implied_prob: side === 'away' ? yesNoPrices.yes : yesNoPrices.no,
              snapshot_time: now,
            })
            insertedEventIds.add(dbEvent.id)
            matchedToEvent++
            const lg = ((dbEvent as any).leagues?.slug) ?? 'unknown'
            insertedByLeague[lg] = (insertedByLeague[lg] ?? 0) + 1
            if (sampleInsertedTitles.length < 10) sampleInsertedTitles.push(`[${lg}] ${dbEvent.title} ← ${polyEvent.title}`)
          }
        }
        continue
      }

      // Team-outcome shape — outcomes are ["Rays","Red Sox"], not Yes/No.
      // Requires an event match to resolve home/away.
      if (!dbEvent || !homeTeam || !awayTeam) { skippedNoPrices++; continue }
      const teamPrices = parseTeamOutcomeMoneyline(market, homeTeam, awayTeam)
      if (!teamPrices) { skippedNoPrices++; teamOutcomeFailed++; continue }
      teamOutcomeParsed++

      // Skip if we already wrote a moneyline for this event (futures-style
      // Yes/No market may have fired earlier in the loop).
      if (insertedEventIds.has(dbEvent.id)) continue

      marketSnapshots.push({
        event_id: dbEvent.id,
        source_id: source.id,
        market_type: 'moneyline',
        home_price: probToAmerican(teamPrices.homeProb),
        away_price: probToAmerican(teamPrices.awayProb),
        home_implied_prob: teamPrices.homeProb,
        away_implied_prob: teamPrices.awayProb,
        snapshot_time: now,
      })
      insertedEventIds.add(dbEvent.id)
      matchedToEvent++
      const lg2 = ((dbEvent as any).leagues?.slug) ?? 'unknown'
      insertedByLeague[lg2] = (insertedByLeague[lg2] ?? 0) + 1
      if (sampleInsertedTitles.length < 10) sampleInsertedTitles.push(`[${lg2}] ${dbEvent.title} ← ${polyEvent.title}`)
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
    eventsWithVs,
    eventsMatchedDb,
    marketsProcessed: predSnapshots.length,
    predInserted,
    marketSnapshotsInserted: marketInserted,
    matchedToSportsbookEvent: matchedToEvent,
    insertedByLeague,
    sampleInsertedTitles,
    teamOutcomeParsed,
    teamOutcomeFailed,
    skippedNoMarkets,
    skippedInactive,
    skippedNoPrices,
    errors: errors.length ? errors : undefined,
  })
}
