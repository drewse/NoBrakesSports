/**
 * Betway Ontario adapter.
 *
 * Two-step API:
 *   1. GetGroup → event IDs (filtered by sport/league)
 *   2. GetEventsWithMultipleMarkets → game lines (filtered) + all markets (unfiltered for props)
 *
 * POST endpoints at betway.ca/ca-on/services/api/events/v2/
 * Odds returned as decimal (1.40 = -250 american)
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'

const BASE = 'https://betway.ca/ca-on/services/api/events/v2'
const COMMON_BODY = {
  BrandId: 3,
  LanguageId: 25,
  TerritoryId: 258,
  TerritoryCode: 'CA-ON',
  ClientTypeId: 1,
  ClientIntegratorId: 1,
  JurisdictionId: 20,
}

// Market CNames vary by sport — include all known variants
const MARKET_CNAMES = [
  'money-line',
  // Basketball/Football
  '-point-spread---0', '-total-points---0',
  // Baseball
  '-run-line---0', '-total-runs---0',
  // Hockey
  '-puck-line---0', '-total-goals---0',
  // Soccer
  'win-draw-win', '-total-goals---0',
]

export const BW_LEAGUES: { category: string; subCategory: string; group: string; leagueSlug: string }[] = [
  { category: 'basketball', subCategory: 'usa', group: 'nba',  leagueSlug: 'nba' },
  { category: 'baseball',   subCategory: 'usa', group: 'mlb',  leagueSlug: 'mlb' },
  { category: 'ice-hockey',  subCategory: 'usa', group: 'nhl',  leagueSlug: 'nhl' },
  { category: 'soccer',     subCategory: 'england', group: 'premier-league', leagueSlug: 'epl' },
  { category: 'soccer',     subCategory: 'spain', group: 'la-liga', leagueSlug: 'laliga' },
  { category: 'soccer',     subCategory: 'germany', group: 'bundesliga', leagueSlug: 'bundesliga' },
  { category: 'soccer',     subCategory: 'italy', group: 'serie-a', leagueSlug: 'seria_a' },
  { category: 'soccer',     subCategory: 'france', group: 'ligue-1', leagueSlug: 'ligue_one' },
]

export interface BWEvent {
  eventId: number
  homeName: string
  awayName: string
  startTime: string
  leagueSlug: string
  sport: string
}

export interface BWGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface BWResult {
  event: BWEvent
  gameMarkets: BWGameMarket[]
  props: NormalizedProp[]
}

// Betway MarketGroupCName → canonical prop category
// Groups from the API: points, rebounds, assists, 3-pointers, combos, defense
const BW_PROP_GROUPS: Record<string, string> = {
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  '3-pointers': 'player_threes',
  'threes': 'player_threes',
  // Baseball
  'hits': 'player_hits',
  'home-runs': 'player_home_runs',
  'rbis': 'player_rbis',
  'strikeouts': 'player_strikeouts_p',
  'pitcher-strikeouts': 'player_strikeouts_p',
  'total-bases': 'player_total_bases',
  'runs': 'player_runs',
  'stolen-bases': 'player_stolen_bases',
  // Hockey
  'goals': 'player_goals',
  'shots-on-goal': 'player_shots_on_goal',
  'saves': 'player_saves',
  // Soccer
  'shots-on-target': 'player_shots_target',
}


/** Extract player name from a Betway prop market Title.
 *  Actual formats from API:
 *    "Total Points - Brandon Miller (CHA)"
 *    "Points and Rebounds - Anthony Black (ORL)"
 *    "Total Blocks - Coby White (CHA)"
 *    "Total 3-Pointers Made - Wendell Carter Jr (ORL)"
 *  Pattern: "Stat Description - Player Name (TEAM)" */
function extractPlayerName(title: string): string | null {
  // Find the LAST " - " to handle stat names that contain dashes (e.g., "3-Pointers")
  const lastDashIdx = title.lastIndexOf(' - ')
  if (lastDashIdx === -1) return null

  const after = title.slice(lastDashIdx + 3).trim()
  // Strip team abbreviation: "(CHA)", "(ORL)", etc.
  const name = after.replace(/\s*\([A-Z]{2,5}\)\s*$/, '').trim()
  if (name.length > 2) return name
  return null
}

/** Detect the prop category from a Betway market Title + group */
function detectPropCategory(title: string, groupCName: string): string | null {
  const lower = title.toLowerCase()

  // Simple stat groups
  // Reject 1st quarter / 1st half / halftime markets — only full-game totals
  if (lower.includes('1st quarter') || lower.includes('1st half') || lower.includes('halftime') || lower.includes('2nd half') || lower.includes('3rd quarter') || lower.includes('4th quarter')) {
    return null
  }

  // Title-based detection (group-independent): Betway's actual title shapes
  // include "Total <Stat> - <Player> (<TEAM>)" for single-stat O/U props and
  // bare "<Stat> - <Player>" (or with combo connectives) for alternates. Be
  // permissive — "includes" instead of "startsWith" — since a non-obvious
  // group name was the reason "Total Assists - <Player>" wasn't landing.
  if (!lower.includes(' - ')) {
    // No player separator — let the group fallback below handle game-level
    // markets that happen to share these stat words.
  } else {
    // Reject MLB multi-stat combos we don't have categories for.
    // Formats seen at Betway:
    //   "Total Hits + Runs + RBI - <Player>"    (plus)
    //   "Hits/Runs/RBI - <Player>"              (slash)
    //   "Hits, Runs, or RBI - <Player>"         (comma+or)
    //   "Runs or RBI - <Player>"                (or)
    // Any of these falling through would land as plain player_rbis /
    // player_hits because the single-stat matcher below is a substring
    // check and hits "rbi" or "hit" inside the combo title.
    const hasComboSeparator = /\s\+\s|\s\/\s|\/|,\s|\bor\b/.test(lower)
    const mlbStatWords = ['hit', 'run', 'rbi', 'home run', 'total base', 'strikeout']
    const mlbMatchCount = mlbStatWords.filter(w => lower.includes(w)).length
    if (hasComboSeparator && mlbMatchCount >= 2) return null

    // 3-pointers / threes
    if (lower.includes('3-pointer') || lower.includes('three pointer') || lower.includes('threes made') || lower.includes('3-point field goal')) {
      return 'player_threes'
    }
    // Combos BEFORE single stats (substring collisions: "points and rebounds"
    // contains both "points" and "rebounds").
    const hasPts = lower.includes('points')
    const hasReb = lower.includes('rebounds')
    const hasAst = lower.includes('assists')
    if (hasPts && hasReb && hasAst) return 'player_pts_reb_ast'
    if (hasPts && hasReb) return 'player_pts_reb'
    if (hasPts && hasAst) return 'player_pts_ast'
    if (hasReb && hasAst) return 'player_ast_reb'
    if (lower.includes('steals') && lower.includes('blocks')) return 'player_steals_blocks'
    // Singles
    if (hasPts) return 'player_points'
    if (hasReb) return 'player_rebounds'
    if (hasAst) return 'player_assists'
    if (lower.includes('blocks')) return 'player_blocks'
    if (lower.includes('steals')) return 'player_steals'
    if (lower.includes('turnover')) return 'player_turnovers'
  }

  // Defense group
  if (groupCName === 'defense') {
    // "Steals and Blocks" is a combo — must check before individual stats
    if (lower.includes('steals') && lower.includes('blocks')) return 'player_steals_blocks'
    if (lower.includes('total blocks')) return 'player_blocks'
    if (lower.includes('total steals')) return 'player_steals'
    if (lower.includes('turnover')) return 'player_turnovers'
    return null // unknown defense market — skip rather than guess
  }

  // Combos group
  if (groupCName === 'combos') {
    if (lower.includes('points') && lower.includes('rebounds') && lower.includes('assists')) return 'player_pts_reb_ast'
    if (lower.includes('points') && lower.includes('rebounds')) return 'player_pts_reb'
    if (lower.includes('points') && lower.includes('assists')) return 'player_pts_ast'
    if (lower.includes('rebounds') && lower.includes('assists')) return 'player_ast_reb'
    return 'player_pts_reb_ast'
  }

  // Baseball — most-specific FIRST so multi-word stats ("total bases",
  // "home runs") aren't swallowed by shorter substring matches. Word-boundary
  // the "rbi" check so it can't match titles like "Total Bases (Hits Only)"
  // that happen to contain "rbi" as part of a combo variant name elsewhere
  // in the string.
  if (lower.includes('total bases')) return 'player_total_bases'
  if (lower.includes('total hits')) return 'player_hits'
  if (lower.includes('home run')) return 'player_home_runs'
  if (lower.includes('strikeout')) return 'player_strikeouts_p'
  if (/\brbis?\b/.test(lower)) return 'player_rbis'
  if (lower.includes('earned run')) return 'player_earned_runs'
  if (lower.includes('stolen base')) return 'player_stolen_bases'

  // Hockey
  if (lower.includes('total goals') || lower.includes('goals scored')) return 'player_goals'
  if (lower.includes('shots on goal')) return 'player_shots_on_goal'
  if (lower.includes('total saves') || lower.includes('saves')) return 'player_saves'

  // Soccer
  if (lower.includes('shots on target')) return 'player_shots_target'

  // Fallback: try group name — but title wins when the title clearly
  // names a DIFFERENT stat than the group claims. Common Betway case:
  // a "Total Bases (Hits Only)" market filed under the rbis group;
  // mapping by group would mislabel it as player_rbis and create phantom
  // arbs vs real RBI lines from other books.
  const fromGroup = BW_PROP_GROUPS[groupCName] ?? null
  if (fromGroup === 'player_rbis' && /hits?|total bases|home run|strikeout/.test(lower)) {
    return null
  }
  if (fromGroup === 'player_hits' && /total bases|rbi|home run|strikeout/.test(lower)) {
    return null
  }
  return fromGroup
}


/** Convert decimal odds to American integer */
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

async function postApi(endpoint: string, body: any): Promise<any> {
  const resp = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })
  if (!resp.ok) throw new Error(`Betway ${endpoint}: HTTP ${resp.status}`)
  return resp.json()
}

async function fetchLeague(league: typeof BW_LEAGUES[number]): Promise<BWResult[]> {
  try {
    // Step 1: GetGroup → event IDs
    const groupData = await postApi('GetGroup', {
      ...COMMON_BODY,
      CategoryCName: league.category,
      SubCategoryCName: league.subCategory,
      GroupCName: league.group,
      PremiumOnly: false,
    })

    if (!groupData.Success) return []

    const gameIds = (groupData.EventSummaries ?? [])
      .filter((e: any) => !e.IsOutright)
      .map((e: any) => e.EventId)

    if (gameIds.length === 0) return []

    // Step 2: GetEventsWithMultipleMarkets → full data
    const data = await postApi('GetEventsWithMultipleMarkets', {
      ...COMMON_BODY,
      EventMarketSets: [{ EventIds: gameIds, MarketCNames: MARKET_CNAMES }],
      ScoreboardRequest: { IncidentRequest: {}, ScoreboardType: 3 },
    })

    if (!data.Success || !data.Events) return []

    // Build outcome map: outcomeId → outcome
    const outcomeMap = new Map<number, any>()
    for (const o of data.Outcomes ?? []) {
      outcomeMap.set(o.Id, o)
    }

    // Build market map: marketId → market
    const marketsByEvent = new Map<number, any[]>()
    for (const m of data.Markets ?? []) {
      if (!marketsByEvent.has(m.EventId)) marketsByEvent.set(m.EventId, [])
      marketsByEvent.get(m.EventId)!.push(m)
    }

    // Parse results
    const results: BWResult[] = []
    for (const ev of data.Events) {
      if (ev.IsLive || ev.IsSuspended) continue

      const startMs = ev.Milliseconds
      const startTime = new Date(startMs).toISOString()

      const bwEvent: BWEvent = {
        eventId: ev.Id,
        homeName: ev.HomeTeamName,
        awayName: ev.AwayTeamName,
        startTime,
        leagueSlug: league.leagueSlug,
        sport: league.category,
      }

      const gameMarkets: BWGameMarket[] = []
      const evMarkets = marketsByEvent.get(ev.Id) ?? []

      for (const market of evMarkets) {
        // Get outcomes for this market
        const allOutcomeIds = (market.Outcomes ?? []).flat() as number[]
        const outcomes = allOutcomeIds.map(id => outcomeMap.get(id)).filter(Boolean)

        const homeOutcome = outcomes.find((o: any) => o.CouponName === 'Home')
        const awayOutcome = outcomes.find((o: any) => o.CouponName === 'Away')
        const overOutcome = outcomes.find((o: any) => o.CouponName === 'Over')
        const underOutcome = outcomes.find((o: any) => o.CouponName === 'Under')
        const drawOutcome = outcomes.find((o: any) => o.CouponName === 'Draw')

        const cname = (market.MarketCName as string).toLowerCase()
        const title = (market.Title as string).toLowerCase()

        if (cname === 'money-line' || cname === 'win-draw-win') {
          gameMarkets.push({
            marketType: 'moneyline',
            homePrice: homeOutcome ? decimalToAmerican(homeOutcome.OddsDecimal) : null,
            awayPrice: awayOutcome ? decimalToAmerican(awayOutcome.OddsDecimal) : null,
            drawPrice: drawOutcome ? decimalToAmerican(drawOutcome.OddsDecimal) : null,
            spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
          })
        } else if (cname.includes('point-spread') || cname.includes('run-line') || cname.includes('puck-line') || cname.includes('handicap')) {
          gameMarkets.push({
            marketType: 'spread',
            homePrice: homeOutcome ? decimalToAmerican(homeOutcome.OddsDecimal) : null,
            awayPrice: awayOutcome ? decimalToAmerican(awayOutcome.OddsDecimal) : null,
            drawPrice: null,
            spreadValue: Math.abs(market.Handicap ?? 0),
            totalValue: null, overPrice: null, underPrice: null,
          })
        } else if (cname.includes('total-points') || cname.includes('total-runs') || cname.includes('total-goals')) {
          gameMarkets.push({
            marketType: 'total',
            homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
            totalValue: market.Handicap ?? null,
            overPrice: overOutcome ? decimalToAmerican(overOutcome.OddsDecimal) : null,
            underPrice: underOutcome ? decimalToAmerican(underOutcome.OddsDecimal) : null,
          })
        }
      }

      results.push({ event: bwEvent, gameMarkets, props: [] })
    }

    // ── Phase 2: Per-event fetch for ALL markets (props) ──
    // GetEventsWithMultipleMarkets without MarketCNames returns nothing,
    // so we fetch each event individually to get all markets + props.
    const resultsByEventId = new Map<number, BWResult>()
    for (const r of results) {
      resultsByEventId.set(r.event.eventId, r)
    }

    const PROP_BATCH = 5
    for (let i = 0; i < gameIds.length; i += PROP_BATCH) {
      const batch = gameIds.slice(i, i + PROP_BATCH)
      await Promise.all(
        batch.map(async (eventId: number) => {
          try {
            const evData = await postApi('GetEventDetails', {
              ...COMMON_BODY,
              EventId: eventId,
              ScoreboardRequest: { IncidentRequest: {}, ScoreboardType: 3 },
            })
            if (!evData?.Success || !evData.Markets) return

            // Build outcome map for this event
            const evOutcomeMap = new Map<number, any>()
            for (const o of evData.Outcomes ?? []) {
              evOutcomeMap.set(o.Id, o)
            }

            // Build set of prop market IDs from MarketGroups. Also build a
            // fallback set of ALL group IDs so title-matched prop markets
            // that live under non-standard group names aren't dropped.
            const propGroups = ['points', 'rebounds', 'assists', '3-pointers', 'threes', 'combos', 'defense',
              'player-points', 'player-rebounds', 'player-assists', 'player-threes', 'player-combos', 'player-defense',
              'player-props', 'player props', 'props',
              'hits', 'home-runs', 'rbis', 'strikeouts', 'pitcher-strikeouts', 'total-bases',
              'runs', 'stolen-bases', 'goals', 'shots-on-goal', 'saves', 'shots-on-target',
              'batter-props', 'pitcher-props']
            const propMarketIds = new Set<number>()
            const marketGroupMap = new Map<number, string>()
            const groups = evData.Event?.MarketGroups ?? {}
            for (const gName of propGroups) {
              const ids: number[] = groups[gName]?.MarketIds ?? []
              for (const id of ids) {
                propMarketIds.add(id)
                marketGroupMap.set(id, gName)
              }
            }
            // Secondary pass: treat any market whose title contains a stat
            // keyword AND a player dash separator as a prop market even if
            // its group wasn't in the known list. Rescues "Total Assists -
            // Daniss Jenkins", "Points and Rebounds - Anthony Black", etc.
            // when Betway files them under a group slug we don't recognize.
            const PROP_STAT_WORDS = /\b(points|rebounds|assists|3-pointer|three pointer|threes|blocks|steals|turnover|hits|home run|rbis?|strikeouts|total bases|runs|stolen bases|walks|earned runs|outs|goals|shots on goal|saves|shots on target|power play)/i
            for (const m of evData.Markets ?? []) {
              const title = (m.Title ?? '') as string
              if (!title.includes(' - ')) continue
              if (!PROP_STAT_WORDS.test(title)) continue
              // Exclude game-level total (no player, no dash suffix)
              if (/^total (points|runs|goals)\s*$/i.test(title.trim())) continue
              propMarketIds.add(m.Id)
            }


            const result = resultsByEventId.get(eventId)
            if (!result) return

            for (const market of evData.Markets) {
              const titleFull = (market.Title ?? '') as string
              const titleLower = titleFull.toLowerCase()

              // ── Game-level "Total Hits" — emit as prop with player='Game' ──
              // Only applies to full-game total hits (no 1st inning, etc.), and title
              // has no player name (no dash).
              if (
                /^total (?:game )?hits\b/i.test(titleFull) &&
                !titleFull.includes(' - ') &&
                !titleLower.includes('inning') &&
                market.Headers?.includes('Over')
              ) {
                const lineValue = market.Handicap ?? null
                if (lineValue != null && lineValue > 0) {
                  const flatIds = (market.Outcomes ?? []).flat() as number[]
                  const outs = flatIds.map((id: number) => evOutcomeMap.get(id)).filter(Boolean)
                  let over: number | null = null
                  let under: number | null = null
                  for (const o of outs) {
                    if (o.CouponName === 'Over' && o.OddsDecimal > 1) over = decimalToAmerican(o.OddsDecimal)
                    else if (o.CouponName === 'Under' && o.OddsDecimal > 1) under = decimalToAmerican(o.OddsDecimal)
                  }
                  if (over != null || under != null) {
                    const result = resultsByEventId.get(market.EventId)
                    if (result) {
                      result.props.push({
                        propCategory: 'game_total_hits',
                        playerName: 'Game',
                        lineValue,
                        overPrice: over,
                        underPrice: under,
                        yesPrice: null, noPrice: null, isBinary: false,
                      })
                    }
                  }
                }
                continue
              }

              // Only process prop markets (skip game-level)
              if (!propMarketIds.has(market.Id)) continue

              const groupCNameT = marketGroupMap.get(market.Id) ?? ''
              const titleT = (market.Title ?? '') as string

              // ── Threshold markets: "Player To Get N+ 3-Pointers" etc. ──
              // Convert to Over (N-0.5) with only over_price.
              const threshMatch = titleT.match(/player to get (\d+)\+\s+(.+?)$/i)
              if (threshMatch) {
                const threshold = parseInt(threshMatch[1], 10)
                const statRaw = threshMatch[2].toLowerCase().trim()
                const THRESH_MAP: Record<string, string> = {
                  'points': 'player_points',
                  'rebounds': 'player_rebounds',
                  'assists': 'player_assists',
                  '3-pointers': 'player_threes',
                  'three pointers': 'player_threes',
                  'steals': 'player_steals',
                  'blocks': 'player_blocks',
                }
                const category = THRESH_MAP[statRaw]
                if (!category) continue

                const lineValue = threshold - 0.5

                const flatIds = (market.Outcomes ?? []).flat() as number[]
                for (const oid of flatIds) {
                  const o = evOutcomeMap.get(oid)
                  if (!o || o.OddsDecimal <= 1) continue
                  // CouponName contains the player name: "Devin Booker (PHX)"
                  const couponName = (o.CouponName ?? '') as string
                  if (!couponName) continue
                  const playerName = couponName.replace(/\s*\([A-Z]{2,5}\)\s*$/, '').trim()
                  if (playerName.length < 3) continue

                  result.props.push({
                    propCategory: category,
                    playerName: normalizePlayerName(playerName),
                    lineValue,
                    overPrice: decimalToAmerican(o.OddsDecimal),
                    underPrice: null,
                    yesPrice: null,
                    noPrice: null,
                    isBinary: false,
                  })
                }
                continue
              }

              // Only O/U markets (must have Over/Under headers)
              if (!market.Headers || !market.Headers.includes('Over')) continue

              const groupCName = marketGroupMap.get(market.Id) ?? ''

              // Determine prop category from title + group
              const propCategory = detectPropCategory(market.Title ?? '', groupCName)
              if (!propCategory) continue

              // Diagnostic: flag titles that classify as MLB stats but
              // contain a disambiguating phrase we might be mishandling
              // ("hits only", parenthetical variants, or a stat name that
              // doesn't match the category we assigned). Logs at most once
              // per category per event to keep the signal readable.
              if (
                (league.category === 'baseball') &&
                (/hits only|\(|\/|,/i.test(market.Title ?? '')) &&
                Math.random() < 0.2   // sample — don't spam
              ) {
                console.log(
                  `[Betway:${league.group}] classified "${market.Title}" as ${propCategory} (group=${groupCName})`,
                )
              }

              // Extract player name: "Total Points - Brandon Miller (CHA)"
              const playerRaw = extractPlayerName(market.Title ?? '')
              if (!playerRaw) continue

              // Get O/U outcomes
              const allOutcomeIds = (market.Outcomes ?? []).flat() as number[]
              const outcomes = allOutcomeIds.map((id: number) => evOutcomeMap.get(id)).filter(Boolean)

              // Use CouponName to reliably identify Over vs Under.
              // OutcomeGroups.yes/no is NOT always Over/Under — Betway sometimes
              // swaps them, creating phantom arbs (e.g., Christian Braun blocks).
              let overOdds: number | null = null
              let underOdds: number | null = null

              for (const o of outcomes) {
                if (o.CouponName === 'Over' && o.OddsDecimal > 1) overOdds = decimalToAmerican(o.OddsDecimal)
                else if (o.CouponName === 'Under' && o.OddsDecimal > 1) underOdds = decimalToAmerican(o.OddsDecimal)
              }

              // Fallback: use Headers position if CouponName missing
              // Headers: ["Over", "Under"] maps to Outcomes[0][0]=Over, Outcomes[0][1]=Under
              if (overOdds == null && underOdds == null && (market.Headers ?? []).includes('Over')) {
                const headers: string[] = market.Headers ?? []
                const flatIds = (market.Outcomes ?? []).flat() as number[]
                for (let idx = 0; idx < headers.length && idx < flatIds.length; idx++) {
                  const o = evOutcomeMap.get(flatIds[idx])
                  if (!o || o.OddsDecimal <= 1) continue
                  if (headers[idx] === 'Over') overOdds = decimalToAmerican(o.OddsDecimal)
                  else if (headers[idx] === 'Under') underOdds = decimalToAmerican(o.OddsDecimal)
                }
              }

              if (overOdds == null && underOdds == null) continue
              const lineValue = market.Handicap ?? null
              if (lineValue == null) continue

              result.props.push({
                propCategory,
                playerName: normalizePlayerName(playerRaw),
                lineValue,
                overPrice: overOdds,
                underPrice: underOdds,
                yesPrice: null,
                noPrice: null,
                isBinary: false,
              })
            }
          } catch (e) {
            // Per-event fetch failed — skip this event's props
          }
        })
      )
    }

    // Dedup props per event: prefer two-sided O/U rows over one-sided threshold rows
    for (const r of results) {
      const map = new Map<string, NormalizedProp>()
      for (const p of r.props) {
        const key = `${p.playerName}|${p.propCategory}|${p.lineValue}`
        const existing = map.get(key)
        if (!existing) {
          map.set(key, p)
          continue
        }
        // Prefer row with both over AND under prices
        const pHasBoth = p.overPrice != null && p.underPrice != null
        const existingHasBoth = existing.overPrice != null && existing.underPrice != null
        if (pHasBoth && !existingHasBoth) map.set(key, p)
      }
      r.props = [...map.values()]
    }

    const propCount = results.reduce((s, r) => s + r.props.length, 0)
    if (propCount > 0) {
      console.log(`[Betway] ${league.group}: ${propCount} player props from ${results.length} events`)
    }

    return results
  } catch (e) {
    console.error(`Betway ${league.group} error:`, e)
    return []
  }
}

/**
 * Full Betway scrape: all leagues, two API calls per league.
 */
export async function scrapeBetway(
  signal?: AbortSignal,
): Promise<BWResult[]> {
  const results = await Promise.all(
    BW_LEAGUES.map(league => fetchLeague(league))
  )
  return results.flat()
}
