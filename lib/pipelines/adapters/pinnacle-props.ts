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
 * Fetch all matchups (games + specials/props) for a league.
 */
async function fetchLeagueMatchups(leagueId: number, signal?: AbortSignal): Promise<PinnacleMatchup[]> {
  const url = `${BASE}/leagues/${leagueId}/matchups`
  try {
    const resp = await fetch(url, { headers: HEADERS, signal })
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
  const resp = await fetch(url, { headers: HEADERS, signal })
  if (!resp.ok) return []
  return resp.json()
}

/**
 * Full Pinnacle scrape: fetch every prop for every event across all configured leagues.
 */
export async function scrapePinnacleProps(
  signal?: AbortSignal,
): Promise<PinnaclePropResult[]> {
  const results: PinnaclePropResult[] = []

  // Fetch all leagues in parallel
  const leagueData = await Promise.all(
    PINNACLE_LEAGUES.map(async (league) => {
      const matchups = await fetchLeagueMatchups(league.leagueId, signal)
      return { league, matchups }
    })
  )

  for (const { league, matchups } of leagueData) {
    // Separate games from specials (props)
    const games = matchups.filter(m => m.type === 'matchup')
    const specials = matchups.filter(m =>
      m.type === 'special' &&
      m.special?.category === 'Player Props' &&
      m.hasMarkets &&
      !m.isLive
    )

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
    for (const s of specials) {
      const parentId = s.parent?.id
      if (!parentId || !gameMap.has(parentId)) continue
      if (!propsByGame.has(parentId)) propsByGame.set(parentId, [])
      propsByGame.get(parentId)!.push(s)
    }

    // Fetch markets for each prop — batch with concurrency limit
    const MAX_CONCURRENT = 5

    for (const [gameId, propMatchups] of propsByGame) {
      const parentEvent = gameMap.get(gameId)!
      const allProps: NormalizedProp[] = []

      // Process props in concurrent batches
      for (let i = 0; i < propMatchups.length; i += MAX_CONCURRENT) {
        const batch = propMatchups.slice(i, i + MAX_CONCURRENT)
        const batchResults = await Promise.all(
          batch.map(async (pm) => {
            const description = pm.special?.description ?? ''
            const mapped = mapPinnacleCategory(description)
            if (!mapped) return []

            const allMarkets = await fetchMatchupMarkets(pm.id, signal)
            const props: NormalizedProp[] = []

            // CRITICAL: /markets/related/straight returns the prop market PLUS
            // all parent game markets (spreads, totals, alternates). Only keep
            // markets for THIS prop's matchupId.
            const markets = allMarkets.filter(m => m.matchupId === pm.id)

            for (const market of markets) {
              // Only period 0 (full game), open markets
              if (market.period !== 0) continue
              if (market.status !== 'open') continue

              if (market.type === 'total' || market.type === 'team_total') {
                const overOutcome = market.prices.find(p => p.designation === 'over')
                const underOutcome = market.prices.find(p => p.designation === 'under')

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
              } else if (market.type === 'moneyline') {
                // Binary prop (e.g., anytime scorer)
                const homeOutcome = market.prices.find(p => p.designation === 'home')
                const awayOutcome = market.prices.find(p => p.designation === 'away')

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
              }
            }

            return props
          })
        )

        allProps.push(...batchResults.flat())
      }

      if (allProps.length > 0) {
        results.push({ parentEvent, props: allProps })
      }
    }
  }

  return results
}
