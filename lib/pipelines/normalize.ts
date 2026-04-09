import type {
  CanonicalEvent,
  CanonicalMarket,
  CanonicalMarketShape,
  CanonicalOutcome,
  CanonicalOutcomeSide,
  CanonicalEventStatus,
} from './types'

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Normalization Hooks
//
// Pure functions — no DB calls, no side effects.
// These provide the shared transformation layer that all adapters will use
// once live ingestion is implemented. They are fully testable in isolation.
// ─────────────────────────────────────────────────────────────────────────────

// ── Implied probability ───────────────────────────────────────────────────────

/**
 * Convert American odds to implied probability (0–1).
 * Does NOT remove vig — this is the raw book probability.
 *
 * @example
 *   americanToImplied(-110) // → 0.5238
 *   americanToImplied(+150) // → 0.4000
 */
export function americanToImplied(american: number): number {
  if (american >= 0) return 100 / (american + 100)
  return Math.abs(american) / (Math.abs(american) + 100)
}

/**
 * Convert implied probability to American odds.
 *
 * @example
 *   impliedToAmerican(0.5238) // → -110 (approx)
 *   impliedToAmerican(0.40)   // → +150
 */
export function impliedToAmerican(prob: number): number {
  if (prob <= 0 || prob >= 1) throw new RangeError(`prob must be between 0 and 1 exclusive, got ${prob}`)
  if (prob >= 0.5) return Math.round(-(prob / (1 - prob)) * 100)
  return Math.round(((1 - prob) / prob) * 100)
}

/**
 * Convert decimal odds to American odds.
 *
 * @example
 *   decimalToAmerican(1.909) // → -110 (approx)
 *   decimalToAmerican(2.5)   // → +150
 */
export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) throw new RangeError(`decimal odds must be > 1, got ${decimal}`)
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

// ── Market shape detection ────────────────────────────────────────────────────

/** Leagues where draw is a valid outcome (3-way moneyline). */
const THREE_WAY_LEAGUE_SLUGS = new Set([
  'epl', 'mls', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'eredivisie',
  'championship', 'scottishprem', 'premierleague_au', 'ligamx', 'brasileirao',
  'uefachampionsleague', 'uefaeuropaleague', 'ncaasoccer', 'nwsl',
  'fifa_world_cup', 'fifa_womens_world_cup',
])

/**
 * Determine the market shape for a given league and market type.
 * Returns '3way' for soccer moneylines, '2way' for everything else.
 */
export function detectMarketShape(
  leagueSlug: string | null,
  marketType: string
): CanonicalMarketShape {
  if (marketType !== 'moneyline') return '2way'
  if (!leagueSlug) return '2way'
  return THREE_WAY_LEAGUE_SLUGS.has(leagueSlug.toLowerCase()) ? '3way' : '2way'
}

// ── Pre-game filter ───────────────────────────────────────────────────────────

/**
 * Returns true only if the event has not yet started.
 * Grace window of 15 minutes — matches that have just kicked off are still
 * considered pre-game for line capture purposes.
 */
export function isPregame(startTimeIso: string, gracePeriodMs = 15 * 60 * 1000): boolean {
  return new Date(startTimeIso).getTime() > Date.now() - gracePeriodMs
}

// ── Event normalization hook ──────────────────────────────────────────────────

export interface RawEventInput {
  externalId: string
  homeTeam: string
  awayTeam: string
  startTime: string
  leagueSlug: string
  sourceSlug: string
  status?: string
}

/**
 * Normalize a raw adapter event object into the canonical event shape.
 * Adapters call this before upserting into the events table.
 */
export function normalizeEvent(raw: RawEventInput): CanonicalEvent {
  const status = mapEventStatus(raw.status ?? 'scheduled')
  return {
    externalId: raw.externalId,
    homeTeam: raw.homeTeam.trim(),
    awayTeam: raw.awayTeam.trim(),
    title: `${raw.homeTeam.trim()} vs ${raw.awayTeam.trim()}`,
    startTime: new Date(raw.startTime).toISOString(),
    leagueSlug: raw.leagueSlug.toLowerCase().trim(),
    sourceSlug: raw.sourceSlug,
    status,
  }
}

/**
 * Compute a deterministic cross-source identity key for an event.
 *
 * Problem solved: every sportsbook has its own internal ID for the same game.
 * If we use `${source}:${sourceId}` as the DB key, Pinnacle and BetRivers
 * create two separate rows for "Toronto Raptors vs Miami Heat" — duplicates.
 *
 * Solution: key on (league, date, normalized home team, normalized away team).
 * All sources describing the same real game map to the same DB row.
 *
 * Date is UTC YYYY-MM-DD — normalizes away the minor start-time differences
 * (one book says 7:00 PM, another says 7:10 PM for the same game).
 * Cross-midnight edge cases are rare for mainstream North American sports.
 *
 * @example
 *   canonicalEventKey(event)
 *   // → "nba:2026-04-09:toronto raptors:miami heat"
 */
export function canonicalEventKey(event: Pick<CanonicalEvent, 'leagueSlug' | 'homeTeam' | 'awayTeam' | 'startTime'>): string {
  const normalizeTeam = (name: string) =>
    name.toLowerCase().trim().replace(/\s+/g, ' ')
  const date = new Date(event.startTime).toISOString().slice(0, 10) // YYYY-MM-DD UTC
  return `${event.leagueSlug}:${date}:${normalizeTeam(event.homeTeam)}:${normalizeTeam(event.awayTeam)}`
}

function mapEventStatus(raw: string): CanonicalEventStatus {
  const s = raw.toLowerCase()
  if (s === 'scheduled' || s === 'pregame' || s === 'upcoming') return 'scheduled'
  if (s === 'live' || s === 'inprogress' || s === 'in_progress') return 'live'
  if (s === 'final' || s === 'finished' || s === 'completed' || s === 'closed') return 'final'
  if (s === 'cancelled' || s === 'canceled' || s === 'postponed') return 'cancelled'
  return 'scheduled'
}

// ── Outcome normalization hook ────────────────────────────────────────────────

export interface RawOutcomeInput {
  side: string          // 'home' | 'away' | 'draw' | 'over' | 'under' or source-specific variant
  label: string
  price: number         // American odds
}

/**
 * Normalize a raw outcome into the canonical shape.
 * Computes impliedProb from the American price.
 */
export function normalizeOutcome(raw: RawOutcomeInput): CanonicalOutcome {
  return {
    side: mapOutcomeSide(raw.side),
    label: raw.label.trim(),
    price: raw.price,
    impliedProb: americanToImplied(raw.price),
  }
}

function mapOutcomeSide(raw: string): CanonicalOutcomeSide {
  const s = raw.toLowerCase()
  if (s === 'home' || s === 'h' || s === '1' || s === 'w1') return 'home'
  if (s === 'away' || s === 'a' || s === '2' || s === 'w2') return 'away'
  if (s === 'draw' || s === 'x' || s === 'tie') return 'draw'
  if (s === 'over' || s === 'o') return 'over'
  if (s === 'under' || s === 'u') return 'under'
  return 'home' // fallback
}

// ── Market normalization hook ─────────────────────────────────────────────────

export interface RawMarketInput {
  eventId: string
  marketType: string
  leagueSlug?: string
  outcomes: RawOutcomeInput[]
  lineValue?: number | null
  sourceSlug: string
  capturedAt?: string
}

/**
 * Normalize a raw adapter market into the canonical market shape.
 */
export function normalizeMarket(raw: RawMarketInput): CanonicalMarket {
  const marketType = mapMarketType(raw.marketType)
  const shape = detectMarketShape(raw.leagueSlug ?? null, marketType)
  return {
    eventId: raw.eventId,
    marketType,
    shape,
    outcomes: raw.outcomes.map(normalizeOutcome),
    lineValue: raw.lineValue ?? null,
    sourceSlug: raw.sourceSlug,
    capturedAt: raw.capturedAt ?? new Date().toISOString(),
  }
}

function mapMarketType(raw: string): 'moneyline' | 'spread' | 'total' {
  const s = raw.toLowerCase().replace(/[_\s-]/g, '')
  if (s === 'moneyline' || s === 'h2h' || s === 'winner' || s === 'ml') return 'moneyline'
  if (s === 'spread' || s === 'handicap' || s === 'ah' || s === 'pointspread') return 'spread'
  if (s === 'total' || s === 'totals' || s === 'ou' || s === 'overunder') return 'total'
  return 'moneyline'
}

// ── Overround (vig) helper ────────────────────────────────────────────────────

/**
 * Compute the overround (sum of implied probabilities) for a set of American odds.
 * A fair market has overround = 1.0; typical books are 1.02–1.10.
 *
 * @example
 *   computeOverround([-110, -110]) // → 1.0476
 */
export function computeOverround(americanOdds: number[]): number {
  return americanOdds.reduce((sum, o) => sum + americanToImplied(o), 0)
}

/**
 * Returns true if the overround suggests the odds are 3-way (regulation only)
 * rather than 2-way. Used to filter out 1X2 odds on hockey/basketball lines.
 *
 * Threshold: if sum of home+away implied probs < 0.85, draw probability is likely
 * missing from a 3-way line (both teams showing as underdogs simultaneously).
 */
export function looksLikeThreeWayOdds(homeAmerican: number, awayAmerican: number): boolean {
  const combined = americanToImplied(homeAmerican) + americanToImplied(awayAmerican)
  return combined < 0.85
}
