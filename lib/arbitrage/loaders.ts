// Server-side loader for /arbitrage. Used by both the SSR page and the
// /api/arbitrage live-polling endpoint. Returns JSON-serializable arbs.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  americanToImpliedProb,
  getMarketShape,
  calcCombinedProb,
  type MarketShape,
} from '@/lib/utils'

const THREE_WAY_SPORT_SLUGS = new Set(['soccer'])

export type UnifiedArb = {
  /** Stable identity for diffing across polls: type + event + outcome + book pair. */
  id: string
  type: 'game' | 'prop'
  eventTitle: string
  league: string
  description: string
  bestSideA: { label: string; price: number; source: string }
  bestSideB: { label: string; price: number; source: string }
  bestDraw?: { price: number; source: string } | null
  combinedProb: number
  profitPct: number
  lastUpdated: string
}

export interface ArbsResult {
  arbs: UnifiedArb[]
  totalArbs: number
  uniqueBooks: number
}

// 15 min, not 5. sync-props + sync-odds run on a 5-min cron, so a 5-min
// cutoff means *every* row from the previous cycle drops out exactly when
// the next cycle is mid-flight — arbs flicker in and out depending on
// where in the cron interval the page loads. 15 min = ~3 cycles, comfortably
// excludes books that have actually missed a sync without strangling fresh
// pairings (e.g., Betway+FanDuel rows captured at minute 0 are still
// "live" at minute 6, but the old 5-min cutoff was filtering them out and
// hiding real arbs that AVO/OddsJam were surfacing).
const FRESHNESS_MS = 15 * 60 * 1000
// PROP_PAGE MUST match Supabase PostgREST's `db-max-rows` setting.
// Project setting was raised from 1000 → 5000 on 2026-05-01 — see README /
// Supabase project settings → API → Max Rows. With db-max-rows=5000, this
// stays in step. If you ever lower db-max-rows, lower PROP_PAGE to match,
// otherwise the page-full check (`firstRows.length < PROP_PAGE`) will fire
// early and silently drop most of the prop data.
const PROP_PAGE = 5000
// Top-N truncation. The page header reports "N opportunities detected"
// from the pre-truncation count, but only the top-N by profit% actually
// render as cards. 50 was too tight — at peak slate we detect 200-300
// arbs and the user scrolled the panel hunting for a specific bet that
// was sitting at #80 (Vucevic ast_reb 6.5 PointsBet O / Betway U at
// 4.9%) and assumed we weren't detecting it. Bumping the cap means
// the panel actually mirrors the detected count up to a reasonable
// upper bound that doesn't blow up the React render.
const TOP_N = 250

// Maximum arb profit we'll surface. Real cross-book arbs cluster in the
// 0.5-5% band; anything above ~15% is almost always a data-quality issue
// on one side — stale odds, an alt-line collapsed onto the main line, or
// a book's line meaning a different scope (1st-period instead of full
// game, etc.). OddsJam / AVO cap at similar thresholds because >15% arbs
// don't actually clear when you try to place both bets.
//
// Recent observed phantoms killed by this cap:
//  - Cavs/Raptors ML +22% (Kalshi bid/ask)
//  - Robertson SOG 4.5 +41% (Rivers Over +128 vs Pinnacle Under +273)
//  - Edgecombe/Merrill 3PM 1.5 from Pinnacle fallback
const MAX_ARB_PROFIT_PCT = 15

function formatPropCat(cat: string): string {
  // Full names (was abbreviated — "Pts" / "Reb" / "TB" — but the user
  // wants "Points" / "Rebounds" / "Total Bases" so the bet card reads
  // unambiguously without the bettor having to decode three-letter
  // abbreviations.
  const labels: Record<string, string> = {
    player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
    player_threes: 'Threes', player_pts_reb_ast: 'Points + Rebounds + Assists',
    player_steals: 'Steals', player_blocks: 'Blocks', player_turnovers: 'Turnovers',
    player_steals_blocks: 'Steals + Blocks',
    player_pts_reb: 'Points + Rebounds', player_pts_ast: 'Points + Assists',
    player_ast_reb: 'Rebounds + Assists',
    player_double_double: 'Double Double', player_triple_double: 'Triple Double',
    game_total_hits: 'Game Total Hits',
    player_hits: 'Hits', player_home_runs: 'Home Runs', player_rbis: 'RBIs',
    player_strikeouts_p: 'Strikeouts', player_earned_runs: 'Earned Runs',
    player_total_bases: 'Total Bases', player_runs: 'Runs',
    player_stolen_bases: 'Stolen Bases', player_walks: 'Walks',
    player_hits_allowed: 'Hits Allowed', pitcher_outs: 'Outs Recorded',
    player_goals: 'Goals', player_hockey_assists: 'Assists',
    player_hockey_points: 'Points', player_shots_on_goal: 'Shots On Goal',
    player_saves: 'Saves', player_power_play_pts: 'Power Play Points',
    player_soccer_goals: 'Goals', player_shots_target: 'Shots On Target',
    anytime_scorer: 'Anytime Goal Scorer',
    anytime_goal_scorer: 'Anytime Goal Scorer',
  }
  return labels[cat] ?? cat.replace(/^player_/, '').replace(/_/g, ' ')
}

export async function loadArbs(
  supabase: SupabaseClient,
  enabledBooks: Set<string> | null,
): Promise<ArbsResult> {
  // Performance: the page used to take 10s+. The two big costs were
  //   1. Embedded joins on prop_odds + current_market_odds — PostgREST
  //      serializes the same event/league/source object onto every row.
  //      For 35k prop rows that's millions of duplicated bytes. Bench
  //      showed flat 0.9s vs joined 3.5s for 36 pages.
  //   2. A count(*) round trip before pagination, ~150ms wasted.
  // Fix: fetch FLAT rows (no embedded joins) and look up event / source
  // metadata from small side queries we'd be running anyway. Then skip
  // count(*) and paginate until a short page tells us we're done.
  //
  // Instrumentation: this loader runs on the SSR page-render path AND
  // the /api/arbitrage poll path. The /api/arbitrage route logs
  // `[api.arbitrage] ... ms=...` already, but that ONLY covers the
  // poll. SSR was uninstrumented, which hid a 6-8s page-load bottleneck
  // for weeks. The `[loadArbs]` log below fires on BOTH paths, so the
  // SSR cost is visible. Grep `[loadArbs]` in Vercel logs to slice.
  const t0 = Date.now()
  const nowIso = new Date().toISOString()
  const staleCutoff = new Date(Date.now() - FRESHNESS_MS).toISOString()

  // Three independent queries fire in parallel: upcoming events with all
  // their league/sport metadata (~500 rows × small payload), every
  // market source (~100 rows, basically free), and the upcoming event id
  // list to feed the row queries.
  const [eventsRes, sourcesRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, title, start_time, status, league:leagues(name, abbreviation, slug, sport:sports(slug))')
      .gt('start_time', nowIso)
      .order('start_time', { ascending: true })
      .limit(500),
    supabase
      .from('market_sources')
      .select('id, name, slug'),
  ])

  const tEvents = Date.now()

  const upcomingEvents = (eventsRes.data ?? []) as any[]
  const upcomingIds = upcomingEvents.map(e => e.id as string)
  if (upcomingIds.length === 0) {
    console.log(`[loadArbs] events=${tEvents - t0}ms result=empty total=${Date.now() - t0}ms`)
    return { arbs: [], totalArbs: 0, uniqueBooks: 0 }
  }
  const eventById = new Map<string, any>(upcomingEvents.map(e => [e.id, e]))
  const sourceById = new Map<string, { id: string; name: string; slug: string }>(
    ((sourcesRes.data ?? []) as any[]).map(s => [s.id, s]),
  )

  const propStaleCutoff = staleCutoff
  // Pagination strategy: count(*) first to size the parallel page array
  // exactly. Tried fanning out 50 unconditional parallel pages without
  // count to skip the round trip, but each page sends an 18KB URL
  // (500-uuid IN clause) and 50 of those at once tripped PostgREST /
  // network — every batch came back with `fetch failed`, killing the
  // whole loader. count(*) is ~150ms on this table; cheap insurance.
  // The big perf win was dropping embedded joins (3.5s → 0.9s on 36
  // pages); pagination shape is secondary.
  // Adaptive paging — fetch page 0 first; if it came back full,
  // fan out the remaining pages in parallel up to MAX_PAGES. With
  // the new (event_id, snapshot_time DESC) composite index the per-
  // page latency is ~50-150ms, so the count(*) round trip we used
  // to do is no longer worth it (~150ms saved on every cycle, and
  // we never wait for count when the data fits in one page).
  const MAX_PAGES = 12   // hard cap = 60_000 prop rows (12 × 5000-row pages, matches PostgREST cap)
  const fetchPropPage = (i: number) =>
    supabase
      .from('prop_odds')
      .select('event_id, source_id, prop_category, player_name, line_value, over_price, under_price, snapshot_time')
      .in('event_id', upcomingIds)
      .gt('snapshot_time', propStaleCutoff)
      .or('over_price.not.is.null,under_price.not.is.null')
      .range(i * PROP_PAGE, (i + 1) * PROP_PAGE - 1)
  const fetchAllProps = async (): Promise<any[]> => {
    const first = await fetchPropPage(0)
    const firstRows = first.data ?? []
    if (firstRows.length < PROP_PAGE) return firstRows
    // Page 0 was full — there's more. Fan out pages 1..MAX_PAGES in
    // parallel and stop once we hit a short page.
    const restBatches = await Promise.all(
      Array.from({ length: MAX_PAGES - 1 }, (_, i) => fetchPropPage(i + 1)),
    )
    const all: any[] = [...firstRows]
    for (const b of restBatches) {
      const rows = b.data ?? []
      all.push(...rows)
      if (rows.length < PROP_PAGE) break
    }
    return all
  }
  const snapshotsPromise = supabase
    .from('current_market_odds')
    .select('event_id, source_id, market_type, home_price, away_price, draw_price, snapshot_time')
    .in('event_id', upcomingIds)
    .eq('market_type', 'moneyline')
    .gt('snapshot_time', staleCutoff)
    .limit(5000)
  const propBatchPromises = fetchAllProps()

  const { data: snapshots } = await snapshotsPromise
  const tSnapshots = Date.now()

  const filteredSnapshots = (snapshots ?? []).filter(s => {
    const slug: string = sourceById.get((s as any).source_id)?.slug ?? ''
    if (slug === 'polymarket') return false
    if (enabledBooks && !enabledBooks.has(slug)) return false
    return true
  })

  const byEvent = new Map<string, any[]>()
  for (const snap of filteredSnapshots) {
    const ev = eventById.get(snap.event_id)
    if (!ev) continue
    if (!byEvent.has(snap.event_id)) byEvent.set(snap.event_id, [])
    byEvent.get(snap.event_id)!.push(snap)
  }

  const gameArbs: Array<{
    eventId: string
    eventTitle: string
    league: string
    shape: MarketShape
    bestHomePrice: number
    bestHomeSource: string
    bestDrawPrice: number | null
    bestDrawSource: string | null
    bestAwayPrice: number
    bestAwaySource: string
    combinedProb: number
    profitPct: number
    lastUpdated: string
  }> = []

  for (const snaps of byEvent.values()) {
    const event = eventById.get(snaps[0].event_id)
    if (!event) continue
    // No isUpcomingEvent check needed — we already SQL-filtered to events
    // with start_time > now in the upcoming-events query.
    const leagueAbbrev: string = event?.league?.abbreviation ?? ''
    const leagueSlug: string = event?.league?.slug ?? ''
    const sportSlug: string = event?.league?.sport?.slug ?? ''
    const shape: MarketShape = THREE_WAY_SPORT_SLUGS.has(sportSlug)
      ? '3way'
      : getMarketShape(leagueSlug || null, sportSlug || null, 'moneyline')

    // Filter 1X2-as-2way snapshots that produce phantom arbs
    const MIN_TWO_WAY_TOTAL = 0.85
    let validSnaps = shape === '2way'
      ? snaps.filter((s: any) => {
          if (s.home_price == null || s.away_price == null) return true
          const total = americanToImpliedProb(s.home_price) + americanToImpliedProb(s.away_price)
          return total >= MIN_TWO_WAY_TOTAL
        })
      : snaps

    // Direction-disagreement filter. The same MLB game can land in our
    // DB with home/away semantically inverted on a minority of books
    // (canonical event title pinpoints one team as home, but a source's
    // adapter writes the other team's price into home_price). Symptom:
    // most books have home as the dog (home_price > away_price implied)
    // while a few have home as the favorite. Pairing across this divide
    // produces phantom arbs (e.g., bestHome from a "Sox dog" book vs
    // bestAway from a "Sox favorite" book — those are the SAME team's
    // price quoted twice).
    //
    // Detect majority orientation and drop the minority. We only enforce
    // this for 2-way markets where both sides exist; 3-way (soccer)
    // skips this since draw odds shift the relative magnitudes.
    if (shape === '2way') {
      let homeAsFav = 0, homeAsDog = 0
      for (const s of validSnaps as any[]) {
        if (s.home_price == null || s.away_price == null) continue
        const hp = americanToImpliedProb(s.home_price)
        const ap = americanToImpliedProb(s.away_price)
        if (hp > ap) homeAsFav++
        else if (ap > hp) homeAsDog++
      }
      // Only filter when there's a clear majority (≥3 books) AND the
      // minority is a small group; otherwise leave snaps untouched so
      // we don't kill thin-coverage events.
      if (homeAsFav + homeAsDog >= 4 && Math.abs(homeAsFav - homeAsDog) >= 2) {
        const consensusHomeIsFav = homeAsFav > homeAsDog
        validSnaps = validSnaps.filter((s: any) => {
          if (s.home_price == null || s.away_price == null) return true
          const hp = americanToImpliedProb(s.home_price)
          const ap = americanToImpliedProb(s.away_price)
          if (hp === ap) return true   // pick'em — orientation indeterminate
          const homeIsFav = hp > ap
          return homeIsFav === consensusHomeIsFav
        })
        if (validSnaps.length === 0) continue
      }
    }

    const withHome = validSnaps.filter((s: any) => s.home_price != null)
    const withAway = validSnaps.filter((s: any) => s.away_price != null)
    const withDraw = validSnaps.filter((s: any) => s.draw_price != null)
    if (withHome.length < 2 || withAway.length < 2) continue
    if (shape === '3way' && withDraw.length === 0) continue

    const homeBySource = new Map<string, any>()
    for (const s of withHome) {
      const ex = homeBySource.get(s.source_id)
      if (!ex || s.home_price! > ex.home_price!) homeBySource.set(s.source_id, s)
    }
    const awayBySource = new Map<string, any>()
    for (const s of withAway) {
      const ex = awayBySource.get(s.source_id)
      if (!ex || s.away_price! > ex.away_price!) awayBySource.set(s.source_id, s)
    }
    const bestDrawSnap = withDraw.length > 0
      ? withDraw.reduce((b: any, s: any) => (s.draw_price! > b.draw_price! ? s : b))
      : null
    if (shape === '3way' && bestDrawSnap == null) continue

    const lastUpdated = snaps.reduce(
      (max: string, s: any) => (s.snapshot_time > max ? s.snapshot_time : max),
      snaps[0].snapshot_time,
    )
    const pairSeen = new Set<string>()

    for (const homeSnap of homeBySource.values()) {
      for (const awaySnap of awayBySource.values()) {
        if ((homeSnap as any).source_id === (awaySnap as any).source_id) continue
        const homeProb = americanToImpliedProb(homeSnap.home_price!)
        const awayProb = americanToImpliedProb(awaySnap.away_price!)
        const drawProb = bestDrawSnap != null
          ? americanToImpliedProb(bestDrawSnap.draw_price!)
          : null
        const combinedProb = calcCombinedProb(shape, homeProb, drawProb, awayProb)
        const profitPct = (1 / combinedProb - 1) * 100
        if (profitPct <= 0) continue
        if (profitPct > MAX_ARB_PROFIT_PCT) continue

        const pairKey = `${(homeSnap as any).source_id}|${(awaySnap as any).source_id}`
        if (pairSeen.has(pairKey)) continue
        pairSeen.add(pairKey)

        gameArbs.push({
          eventId: event?.id ?? '',
          eventTitle: event?.title ?? '—',
          league: leagueAbbrev || '—',
          shape,
          bestHomePrice: homeSnap.home_price!,
          bestHomeSource: sourceById.get((homeSnap as any).source_id)?.name ?? '—',
          bestDrawPrice: bestDrawSnap?.draw_price ?? null,
          bestDrawSource: bestDrawSnap != null ? (sourceById.get((bestDrawSnap as any).source_id)?.name ?? '—') : null,
          bestAwayPrice: awaySnap.away_price!,
          bestAwaySource: sourceById.get((awaySnap as any).source_id)?.name ?? '—',
          combinedProb,
          profitPct,
          lastUpdated,
        })
      }
    }
  }

  // ── Prop arbs ─────────────────────────────────────────────────────────────
  const propArbs: Array<{
    eventId: string
    eventTitle: string
    league: string
    propCategory: string
    playerName: string
    lineValue: number
    bestOverPrice: number
    bestOverSource: string
    bestUnderPrice: number
    bestUnderSource: string
    combinedProb: number
    profitPct: number
    lastUpdated: string
  }> = []

  const propOddsRaw: any[] = await propBatchPromises
  const tProps = Date.now()
  if (propOddsRaw && propOddsRaw.length > 0) {
    // DFS / pick-em platforms (Sleeper, PrizePicks, Underdog) are not
    // real two-sided money lines — their "odds" are projection leans
    // for pick-count parlay payouts, not standalone bets. Pairing them
    // against a real sportsbook's under produces phantom arbs (e.g.
    // Sleeper SOG 4.5 over +114 vs PointsBet under +275 looking like
    // a 36% arb). Exclude them from arb candidate pools entirely.
    const DFS_SLUGS = new Set(['sleeper', 'prizepicks', 'underdog'])
    const filteredProps = propOddsRaw.filter((p: any) => {
      const slug = sourceById.get(p.source_id)?.slug ?? ''
      if (DFS_SLUGS.has(slug)) return false
      if (enabledBooks && !enabledBooks.has(slug)) return false
      // Drop rows whose event isn't in the upcoming-events set (the SQL
      // filter already enforced this; this just guards against a race
      // where an event flipped to live between the two queries).
      if (!eventById.has(p.event_id)) return false
      return true
    })
    // Dedupe by (event, category, player, line, source) keeping the most-
    // recent snapshot — same fix as the +EV loader. Without this the
    // bestOverBySource / bestUnderBySource maps just collapse the noise
    // away, but it's still wasted work and the upstream group loses
    // determinism if a book has stale rows.
    const latestPropBySrc = new Map<string, any>()
    for (const p of filteredProps) {
      const k = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}|${p.source_id}`
      const existing = latestPropBySrc.get(k)
      if (!existing || p.snapshot_time > existing.snapshot_time) {
        latestPropBySrc.set(k, p)
      }
    }
    // Fuzzy player-name bucket. Some books ship MLB / NHL props with the
    // first name abbreviated ("A. Osuna") while others ship the full name
    // ("Alejandro Osuna"). With a strict `player_name` key those rows
    // never group together, so a real cross-book arb (BetMGM "A. Osuna"
    // -145/+105 vs Betway "Alejandro Osuna" +125/-165 → 7.3%) silently
    // disappears. We bucket by `{firstInitial}{lastName}` (lowercased,
    // ASCII-folded) so both forms collapse into the same group. The
    // chosen display name is the longest variant we saw (so cards still
    // read as "Alejandro Osuna" not "A. Osuna").
    const fuzzyPlayerKey = (raw: string): string => {
      const base = raw
        .toLowerCase()
        .normalize('NFD')
        // strip combining marks
        .replace(/\p{M}/gu, '')
        // strip apostrophes inside names ("o'neal" → "oneal")
        .replace(/'/g, '')
        .replace(/\./g, '')
        .trim()
      if (!base) return raw.toLowerCase()
      const parts = base.split(/\s+/).filter(Boolean)
      if (parts.length === 1) return parts[0]
      const first = parts[0]
      // Treat suffix tokens as part of the last word
      const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/i
      let last = parts[parts.length - 1]
      if (SUFFIX.test(last) && parts.length >= 2) last = parts[parts.length - 2]
      return `${first.charAt(0)}|${last}`
    }
    const propGroups = new Map<string, any[]>()
    const groupDisplayName = new Map<string, string>()
    for (const p of latestPropBySrc.values()) {
      const fuzzy = fuzzyPlayerKey(String(p.player_name ?? ''))
      const key = `${p.event_id}|${p.prop_category}|${fuzzy}|${p.line_value}`
      if (!propGroups.has(key)) propGroups.set(key, [])
      propGroups.get(key)!.push(p)
      // Track longest seen full name as the canonical display label,
      // so a "A. Osuna" / "Alejandro Osuna" pair surfaces as the latter.
      const prev = groupDisplayName.get(key)
      const cand = String(p.player_name ?? '')
      if (!prev || cand.length > prev.length) groupDisplayName.set(key, cand)
    }
    for (const [groupKey, group] of propGroups.entries()) {
      if (group.length < 2) continue
      const displayName = groupDisplayName.get(groupKey) ?? group[0].player_name
      const withOver = group.filter((p: any) => p.over_price != null)
      const withUnder = group.filter((p: any) => p.under_price != null)
      if (withOver.length === 0 || withUnder.length === 0) continue

      const bestOverBySource = new Map<string, any>()
      for (const p of withOver) {
        const existing = bestOverBySource.get(p.source_id)
        if (!existing || p.over_price > existing.over_price) bestOverBySource.set(p.source_id, p)
      }
      const bestUnderBySource = new Map<string, any>()
      for (const p of withUnder) {
        const existing = bestUnderBySource.get(p.source_id)
        if (!existing || p.under_price > existing.under_price) bestUnderBySource.set(p.source_id, p)
      }

      const latestUpdated = group.reduce(
        (max: string, p: any) => (p.snapshot_time > max ? p.snapshot_time : max),
        group[0].snapshot_time,
      )
      const pairSeen = new Set<string>()

      for (const overRow of bestOverBySource.values()) {
        for (const underRow of bestUnderBySource.values()) {
          if (overRow.source_id === underRow.source_id) continue
          const overProb = americanToImpliedProb(overRow.over_price)
          const underProb = americanToImpliedProb(underRow.under_price)
          const combinedProb = overProb + underProb
          if (!isFinite(overProb) || !isFinite(underProb) || combinedProb <= 0) continue
          const profitPct = (1 / combinedProb - 1) * 100
          if (!isFinite(profitPct) || profitPct <= 0) continue
          if (profitPct > MAX_ARB_PROFIT_PCT) continue

          const pairKey = `${overRow.source_id}|${underRow.source_id}`
          if (pairSeen.has(pairKey)) continue
          pairSeen.add(pairKey)

          const ev = eventById.get(overRow.event_id)
          propArbs.push({
            eventId: overRow.event_id,
            eventTitle: ev?.title ?? '—',
            league: ev?.league?.abbreviation ?? '—',
            propCategory: overRow.prop_category,
            playerName: displayName,
            lineValue: overRow.line_value,
            bestOverPrice: overRow.over_price,
            bestOverSource: sourceById.get((overRow as any).source_id)?.name ?? '—',
            bestUnderPrice: underRow.under_price,
            bestUnderSource: sourceById.get((underRow as any).source_id)?.name ?? '—',
            combinedProb,
            profitPct,
            lastUpdated: latestUpdated,
          })
        }
      }
    }
  }

  // Pull a short display name out of "City Mascot" team strings —
  // "Chicago White Sox" → "White Sox", "Los Angeles Lakers" → "Lakers".
  // Two-word mascots get preserved; everything else uses the last word.
  const shortTeam = (full: string): string => {
    const parts = full.trim().split(/\s+/)
    if (parts.length <= 1) return full
    const lastTwo = parts.slice(-2).join(' ')
    if (/^(white sox|red sox|blue jays|trail blazers|maple leafs|golden knights|golden state|red wings|blue jackets)$/i.test(lastTwo)) {
      return lastTwo
    }
    return parts[parts.length - 1]
  }

  const allArbs: UnifiedArb[] = []
  for (const arb of gameArbs) {
    // Parse team names from the event title's "Home vs Away" convention,
    // then label sides as "<Team> ML" so the bet card reads as the
    // actual side of the line instead of the generic "Home" / "Away".
    const titleParts = arb.eventTitle.split(/\s+vs\.?\s+/i)
    const homeTeam = (titleParts[0] ?? 'Home').trim()
    const awayTeam = (titleParts[1] ?? 'Away').trim()
    const suffix = arb.shape === '3way' ? '' : ' ML'
    allArbs.push({
      id: `game::${arb.eventId}::${arb.shape}::${arb.bestHomeSource}::${arb.bestAwaySource}`,
      type: 'game',
      eventTitle: arb.eventTitle,
      league: arb.league,
      description: arb.shape === '3way' ? 'Moneyline 3W' : 'Moneyline',
      bestSideA: { label: `${shortTeam(homeTeam)}${suffix}`, price: arb.bestHomePrice, source: arb.bestHomeSource },
      bestSideB: { label: `${shortTeam(awayTeam)}${suffix}`, price: arb.bestAwayPrice, source: arb.bestAwaySource },
      bestDraw: arb.bestDrawPrice != null
        ? { price: arb.bestDrawPrice, source: arb.bestDrawSource ?? '—' }
        : null,
      combinedProb: arb.combinedProb,
      profitPct: arb.profitPct,
      lastUpdated: arb.lastUpdated,
    })
  }
  for (const arb of propArbs) {
    // Player-prop side labels include the line value so each card shows
    // exactly which side of the line the bet covers, e.g. "Over 4.5".
    const lineSuffix = arb.lineValue != null ? ` ${arb.lineValue}` : ''
    allArbs.push({
      id: `prop::${arb.eventId}::${arb.propCategory}::${arb.playerName}::${arb.lineValue}::${arb.bestOverSource}::${arb.bestUnderSource}`,
      type: 'prop',
      eventTitle: arb.eventTitle,
      league: arb.league,
      description: `${arb.playerName} ${formatPropCat(arb.propCategory)}${arb.lineValue != null ? ` ${arb.lineValue}` : ''}`,
      bestSideA: { label: `Over${lineSuffix}`, price: arb.bestOverPrice, source: arb.bestOverSource },
      bestSideB: { label: `Under${lineSuffix}`, price: arb.bestUnderPrice, source: arb.bestUnderSource },
      bestDraw: null,
      combinedProb: arb.combinedProb,
      profitPct: arb.profitPct,
      lastUpdated: arb.lastUpdated,
    })
  }

  allArbs.sort((a, b) => b.profitPct - a.profitPct)
  const totalArbs = allArbs.length
  if (allArbs.length > TOP_N) allArbs.length = TOP_N

  const uniqueBooks = new Set([
    ...allArbs.map(a => a.bestSideA.source),
    ...allArbs.map(a => a.bestSideB.source),
  ]).size

  // Single structured line — phases broken out so a slow phase is
  // immediately attributable. Fields:
  //   events    : initial events + sources parallel queries
  //   snaps     : current_market_odds query
  //   props     : full paginated prop_odds fetch (sequential page0 + parallel rest)
  //   compute   : JS arb-pairing + dedup + sort
  //   total     : end-to-end
  //   eventsN/snapsN/propsN/arbsN : row counts that gate compute work
  const tDone = Date.now()
  console.log(
    `[loadArbs] events=${tEvents - t0}ms snaps=${tSnapshots - tEvents}ms ` +
    `props=${tProps - tSnapshots}ms compute=${tDone - tProps}ms total=${tDone - t0}ms ` +
    `eventsN=${upcomingEvents.length} snapsN=${snapshots?.length ?? 0} ` +
    `propsN=${propOddsRaw.length} arbsN=${totalArbs}`,
  )
  return { arbs: allArbs, totalArbs, uniqueBooks }
}
