/**
 * Pinnacle full prop scraper.
 *
 * Fetches EVERY player prop matchup and its markets across configured leagues.
 * Free, no auth needed — uses public guest API key.
 *
 * Endpoint pattern:
 *   GET /0.1/leagues/{leagueId}/matchups           → list all matchups + specials
 *   GET /0.1/matchups/{matchupId}/markets/related/straight → get odds for a matchup
 */

import {
  mapPinnacleCategory,
  normalizePlayerName,
  americanToImpliedProb,
  type NormalizedProp,
} from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://guest.api.arcadia.pinnacle.com/0.1'
const API_KEY = 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R'
const HEADERS: Record<string, string> = {
  'x-api-key': API_KEY,
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

// Pinnacle league IDs
export const PINNACLE_LEAGUES: { sport: string; leagueId: number; name: string }[] = [
  { sport: 'basketball', leagueId: 487,  name: 'NBA' },
  { sport: 'baseball',   leagueId: 246,  name: 'MLB' },
  { sport: 'ice_hockey', leagueId: 1456, name: 'NHL' },
  { sport: 'soccer',     leagueId: 1980, name: 'EPL' },
  { sport: 'soccer',     leagueId: 2436, name: 'La Liga' },
  { sport: 'soccer',     leagueId: 2627, name: 'Bundesliga' },
  { sport: 'soccer',     leagueId: 2242, name: 'Serie A' },
  { sport: 'soccer',     leagueId: 2036, name: 'Ligue 1' },
  { sport: 'soccer',     leagueId: 2386, name: 'Liga MX' },
  { sport: 'soccer',     leagueId: 6816, name: 'Copa Libertadores' },
]

interface PinnacleMatchup {
  id: number
  type: 'matchup' | 'special'
  participants?: { name: string; alignment?: string }[]
  special?: {
    category: string
    description: string
  }
  league?: { id: number; name?: string }
  parent?: { id: number }
  startTime?: string
  isLive?: boolean
  hasMarkets?: boolean
}

interface PinnacleMarket {
  matchupId: number
  type: string          // 'total', 'moneyline', 'spread', 'team_total'
  isAlternate?: boolean
  prices: {
    designation: string // 'over', 'under', 'home', 'away'
    price: number       // American odds
    points?: number     // line value
    participantId?: number
  }[]
  status: string
  period: number
}

export interface PinnacleEvent {
  matchupId: number
  name: string
  homeName: string
  awayName: string
  startTime: string
  sport: string
  leagueName: string
}

export interface PinnaclePropResult {
  parentEvent: PinnacleEvent
  props: NormalizedProp[]
}

/**
 * Fetch with retry on transient network errors. Pinnacle's public
 * guest API drops TLS connections under load ("Client network socket
 * disconnected before secure TLS connection was established" =
 * ECONNRESET) — always the first connection after a cold period.
 * Retry twice with short backoff; most resets resolve on the second
 * attempt.
 */
async function pipeFetchRetry(
  url: string,
  signal?: AbortSignal,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await pipeFetch(url, { headers: HEADERS, signal })
    } catch (e) {
      lastErr = e
      if (signal?.aborted) throw e
      // Backoff: 200ms, 600ms, 1400ms
      await new Promise(r => setTimeout(r, 200 + 400 * i * (i + 1)))
    }
  }
  throw lastErr
}

/**
 * Fetch all matchups (games + specials/props) for a league.
 */
async function fetchLeagueMatchups(leagueId: number, signal?: AbortSignal): Promise<PinnacleMatchup[]> {
  const url = `${BASE}/leagues/${leagueId}/matchups`
  try {
    const resp = await pipeFetchRetry(url, signal)
    if (!resp.ok) {
      console.error(`Pinnacle matchups ${leagueId}: HTTP ${resp.status}`)
      return []
    }
    return resp.json()
  } catch (e) {
    console.error(`Pinnacle matchups ${leagueId} fetch error:`, e)
    return []
  }
}

/**
 * Fetch odds/markets for a specific matchup (prop or game).
 */
async function fetchMatchupMarkets(matchupId: number, signal?: AbortSignal): Promise<PinnacleMarket[]> {
  const url = `${BASE}/matchups/${matchupId}/markets/related/straight`
  try {
    const resp = await pipeFetchRetry(url, signal)
    if (!resp.ok) return []
    return resp.json()
  } catch (e) {
    console.error(`Pinnacle market ${matchupId} fetch error:`, e)
    return []
  }
}

/**
 * Full Pinnacle scrape: fetch every prop for every event across all configured leagues.
 */
export async function scrapePinnacleProps(
  signal?: AbortSignal,
): Promise<PinnaclePropResult[]> {
  const results: PinnaclePropResult[] = []

  // Fetch leagues 3 at a time. All 10 in parallel triggered enough
  // simultaneous TLS handshakes that Pinnacle reset connections on
  // about half of them (ECONNRESET) — consistently NBA, MLB, NHL and
  // a couple of soccer leagues. Batching + retry inside
  // fetchLeagueMatchups brings success rate to ~100%.
  const leagueData: Array<{ league: typeof PINNACLE_LEAGUES[number]; matchups: PinnacleMatchup[] }> = []
  const LEAGUE_CONCURRENCY = 3
  for (let i = 0; i < PINNACLE_LEAGUES.length; i += LEAGUE_CONCURRENCY) {
    if (signal?.aborted) break
    const batch = PINNACLE_LEAGUES.slice(i, i + LEAGUE_CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map(async (league) => {
        const matchups = await fetchLeagueMatchups(league.leagueId, signal)
        return { league, matchups }
      })
    )
    leagueData.push(...batchResults)
  }

  for (const { league, matchups } of leagueData) {
    // Separate games from specials (props).
    const games = matchups.filter(m => m.type === 'matchup')
    const allSpecials = matchups.filter(m => m.type === 'special' && !m.isLive)
    // Gate on description shape (not special.category — Pinnacle uses
    // different category names across leagues: 'Player Props' for NHL,
    // other buckets for NBA / MLB). mapPinnacleCategory only returns
    // non-null for "Player Name (Stat)" where Stat is in our map.
    // Dropped the hasMarkets check — Pinnacle reports hasMarkets=false
    // on plenty of specials that actually have open markets; filtering
    // on it silently dropped NBA / MLB props.
    const specials = allSpecials.filter(m => {
      const desc = m.special?.description ?? ''
      return mapPinnacleCategory(desc) !== null
    })

    // Build parent game map: gameId → event info
    const gameMap = new Map<number, PinnacleEvent>()
    for (const g of games) {
      if (g.isLive) continue
      const home = g.participants?.find(p => p.alignment === 'home')?.name ?? ''
      const away = g.participants?.find(p => p.alignment === 'away')?.name ?? ''
      gameMap.set(g.id, {
        matchupId: g.id,
        name: `${away} @ ${home}`,
        homeName: home,
        awayName: away,
        startTime: g.startTime ?? '',
        sport: league.sport,
        leagueName: league.name,
      })
    }

    // Group specials by parent game
    const propsByGame = new Map<number, PinnacleMatchup[]>()
    let orphanedSpecials = 0
    for (const s of specials) {
      const parentId = s.parent?.id
      if (!parentId || !gameMap.has(parentId)) { orphanedSpecials++; continue }
      if (!propsByGame.has(parentId)) propsByGame.set(parentId, [])
      propsByGame.get(parentId)!.push(s)
    }

    // Per-league visibility: which filter step is dropping props. If
    // NBA shows `allSpecials=120, descMatched=0`, the description
    // format differs from "Name (Stat)". If descMatched is healthy but
    // orphaned=allMatched, the parent-id linkage is broken.
    console.log(`[pinnacle-props:${league.name}] matchups=${matchups.length} games=${gameMap.size} allSpecials=${allSpecials.length} descMatched=${specials.length} orphaned=${orphanedSpecials} propsByGame=${propsByGame.size}`)
    if (specials.length === 0 && allSpecials.length > 0) {
      // Print a handful of raw descriptions so we can see the shape
      // Pinnacle is actually sending for this league.
      const samples = allSpecials.slice(0, 8).map(s => s.special?.description ?? '').filter(Boolean)
      console.log(`[pinnacle-props:${league.name}] sample descriptions:`, samples)
    }

    // Fetch markets for each prop — batch with concurrency limit.
    // Use Promise.allSettled (not Promise.all) and a per-prop try/catch
    // so a malformed market on one special doesn't reject the whole
    // Promise.all and propagate up, which would kill every league's
    // worth of work and leave sync-props with pinnacleResults=[].
    const MAX_CONCURRENT = 5

    // Per-league market-fetch diagnostics.
    const diag = {
      propsCalled: 0,
      fetchEmpty: 0,
      afterMatchupFilter: 0,
      skippedPeriod: 0,
      skippedStatus: 0,
      skippedType: 0,
      emitted: 0,
    }
    const observedStatuses = new Set<string>()
    const observedTypes = new Set<string>()
    let firstMarketSample: any = null

    for (const [gameId, propMatchups] of propsByGame) {
      const parentEvent = gameMap.get(gameId)!
      const allProps: NormalizedProp[] = []

      for (let i = 0; i < propMatchups.length; i += MAX_CONCURRENT) {
        const batch = propMatchups.slice(i, i + MAX_CONCURRENT)
        const batchResults = await Promise.allSettled(
          batch.map(async (pm) => {
            try {
              const description = pm.special?.description ?? ''
              const mapped = mapPinnacleCategory(description)
              if (!mapped) return [] as NormalizedProp[]

              diag.propsCalled++
              const allMarkets = await fetchMatchupMarkets(pm.id, signal)
              if (allMarkets.length === 0) diag.fetchEmpty++
              const markets = allMarkets.filter(m => m?.matchupId === pm.id)
              diag.afterMatchupFilter += markets.length
              // Sample the FIRST actually-matched prop market (not the
              // parent game moneyline). That's the row our status/type
              // filters reject — the thing we need eyes on.
              if (!firstMarketSample && markets.length > 0) {
                firstMarketSample = {
                  propMatchupId: pm.id,
                  propDescription: description,
                  matchedMarketCount: markets.length,
                  matchedMarkets: markets.slice(0, 3),
                }
              }
              const props: NormalizedProp[] = []

              for (const market of markets) {
                observedStatuses.add(String(market.status))
                observedTypes.add(String(market.type))
                if (market.period !== 0) { diag.skippedPeriod++; continue }
                // Widened: accept anything that isn't explicitly closed /
                // suspended / settled. Pinnacle's prop markets currently ship
                // with a status other than 'open' (diagnostics showed every
                // prop-matched market was rejected by `=== 'open'`). A prop
                // with a suspended flag wouldn't have live prices anyway, so
                // we just keep it if status looks tradeable.
                const st = String(market.status ?? '').toLowerCase()
                if (st === 'closed' || st === 'suspended' || st === 'settled') { diag.skippedStatus++; continue }
                const prices = market.prices ?? []

                if (market.type === 'total' || market.type === 'team_total') {
                  const overOutcome = prices.find(p => p?.designation === 'over')
                  const underOutcome = prices.find(p => p?.designation === 'under')
                  props.push({
                    propCategory: mapped.category,
                    playerName: mapped.playerName,
                    lineValue: overOutcome?.points ?? underOutcome?.points ?? null,
                    overPrice: overOutcome?.price ?? null,
                    underPrice: underOutcome?.price ?? null,
                    yesPrice: null,
                    noPrice: null,
                    isBinary: false,
                  })
                  diag.emitted++
                } else if (market.type === 'moneyline') {
                  const homeOutcome = prices.find(p => p?.designation === 'home')
                  const awayOutcome = prices.find(p => p?.designation === 'away')
                  props.push({
                    propCategory: mapped.category,
                    playerName: mapped.playerName,
                    lineValue: null,
                    overPrice: null,
                    underPrice: null,
                    yesPrice: homeOutcome?.price ?? null,
                    noPrice: awayOutcome?.price ?? null,
                    isBinary: true,
                  })
                  diag.emitted++
                } else {
                  diag.skippedType++
                }
              }
              return props
            } catch (e) {
              console.error(`[pinnacle-props] per-prop handler threw`, { matchupId: pm.id, err: e instanceof Error ? e.message : String(e) })
              return [] as NormalizedProp[]
            }
          })
        )

        for (const r of batchResults) {
          if (r.status === 'fulfilled') allProps.push(...r.value)
        }
      }

      if (allProps.length > 0) {
        results.push({ parentEvent, props: allProps })
      }
    }

    // Only log diagnostics for leagues that had specials grouped.
    if (propsByGame.size > 0) {
      console.log(`[pinnacle-props:${league.name}] market-fetch diag`, diag, 'statuses=', [...observedStatuses], 'types=', [...observedTypes])
      if (firstMarketSample) {
        console.log(`[pinnacle-props:${league.name}] first matched market sample`, JSON.stringify(firstMarketSample).slice(0, 1200))
      }
    }
  }

  console.log(`[pinnacle-props] returning ${results.length} parent-events (${results.reduce((s, r) => s + r.props.length, 0)} total props)`)
  return results
}
