/** Shared types mirroring the main app's pipeline contracts. */

export interface NormalizedEvent {
  externalId?: string   // book's native event ID (optional — we use canonicalEventKey)
  homeTeam: string
  awayTeam: string
  startTime: string      // ISO
  leagueSlug: string     // e.g. "nba"
  sport: string          // e.g. "basketball"
}

export type MarketType =
  | 'moneyline' | 'spread' | 'total'
  | 'moneyline_h1' | 'spread_h1' | 'total_h1' | 'total_i1' | 'team_total'
  | 'futures'

export interface GameMarket {
  marketType: MarketType
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface NormalizedProp {
  propCategory: string   // canonical: 'player_points' etc.
  playerName: string
  lineValue: number | null
  overPrice: number | null
  underPrice: number | null
  yesPrice: number | null
  noPrice: number | null
  isBinary: boolean
}

export interface ScrapedEvent {
  event: NormalizedEvent
  gameMarkets: GameMarket[]
  props: NormalizedProp[]
}

/** Run context passed into every adapter scrape. */
export interface RunContext {
  signal: AbortSignal
  log: import('./logger.js').Logger
}

export interface ScrapeResult {
  events: ScrapedEvent[]
  errors: string[]
}
