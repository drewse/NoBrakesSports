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
  // Tier 1
  'epl', 'mls', 'laliga', 'bundesliga', 'seria_a', 'ligue_one', 'eredivisie',
  'liga_portugal', 'spl',
  // Americas
  'liga_mx', 'brazil_serie_a', 'brazil_serie_b', 'copa_libertadores', 'copa_sudamericana',
  'argentina_primera', 'chile_primera', 'league_of_ireland',
  // UEFA
  'ucl', 'uel', 'uecl', 'ucl_women', 'fa_cup', 'dfb_pokal', 'copa_del_rey', 'coupe_de_france',
  // Second tiers
  'efl_champ', 'efl_league1', 'efl_league2', 'championship', 'league_one', 'league_two',
  'scottish_prem', 'bundesliga2', 'bundesliga3', 'la_liga2', 'ligue_two', 'serie_b',
  // Europe
  'austria_bundesliga', 'belgium_pro_a', 'swiss_super', 'swiss_super_league',
  'belgian_pro_league', 'super_lig', 'turkish_super_lig', 'frauen_bundesliga',
  'norway_eliteserien', 'denmark_superliga', 'danish_superliga',
  'sweden_allsvenskan', 'swedish_allsvenskan', 'finland_veikkaus',
  'greece_super', 'ekstraklasa', 'russia_premier',
  // Asia / Middle East
  'j_league', 'k_league1', 'k_league', 'australia_aleague', 'a_league',
  'china_super', 'saudi_pro', 'saudi_pro_league', 'isl',
  // International
  'fifa_wc', 'fifa_world_cup', 'fifa_womens_world_cup', 'wcq_europe',
  'uefa_euro', 'copa_america', 'concacaf_nations', 'africa_cup',
  // NWSL / NCAA
  'nwsl', 'ncaasoccer',
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
// City abbreviation → full name mapping for canonical team name
// normalization. Every ABBR covers any team from that city across NBA /
// MLB / NHL / NFL so "HOU Rockets" and "Houston Rockets" collapse to
// the same canonical key (otherwise duplicate event rows get created —
// one from the short-form source like Sportzino/Polymarket, one from
// the full-name sources).
//
// Each alias appears twice: with a trailing space (for "ABBR Nickname"
// format like "HOU Rockets") and without (for the rare bare-abbr
// case). Matching is first-hit startsWith, so insertion order matters
// — specific/longer prefixes must come BEFORE their shorter variants
// ("okc " before any generic "ok" entry).
// Space-terminated prefixes only. Bare forms (e.g. 'bos': 'boston')
// triggered on full names like "boston celtics" via startsWith → the
// slice-after-abbr produced garbage like "bostonton celtics" that hashed
// to a second canonical key and created duplicate event rows. Every real
// adapter input is "Abbr Nickname" or "Full City Nickname" — both forms
// are captured by the space-suffixed keys.
const TEAM_CITY_ALIASES: Record<string, string> = {
  // 3-letter
  'okc ': 'oklahoma city ',
  'phi ': 'philadelphia ',
  'phx ': 'phoenix ',
  'pho ': 'phoenix ',
  'hou ': 'houston ',
  'por ': 'portland ',
  'orl ': 'orlando ',
  'chi ': 'chicago ',
  'det ': 'detroit ',
  'atl ': 'atlanta ',
  'bos ': 'boston ',
  'was ': 'washington ',
  'wsh ': 'washington ',
  'dal ': 'dallas ',
  'den ': 'denver ',
  'mia ': 'miami ',
  'min ': 'minnesota ',
  'mil ': 'milwaukee ',
  'mem ': 'memphis ',
  'ind ': 'indiana ',
  'sac ': 'sacramento ',
  'uta ': 'utah ',
  'cle ': 'cleveland ',
  'nsh ': 'nashville ',
  'cgy ': 'calgary ',
  'van ': 'vancouver ',
  'edm ': 'edmonton ',
  'mtl ': 'montreal ',
  'ott ': 'ottawa ',
  'wpg ': 'winnipeg ',
  'buf ': 'buffalo ',
  'cin ': 'cincinnati ',
  'pit ': 'pittsburgh ',
  'bal ': 'baltimore ',
  'jax ': 'jacksonville ',
  'ten ': 'tennessee ',
  'car ': 'carolina ',
  'ari ': 'arizona ',
  'cha ': 'charlotte ',
  'col ': 'colorado ',
  'sea ': 'seattle ',
  'tor ': 'toronto ',
  // 2-letter
  'la ': 'los angeles ',
  'ny ': 'new york ',
  'sf ': 'san francisco ',
  'gs ': 'golden state ',
  'sa ': 'san antonio ',
  'sd ': 'san diego ',
  'kc ': 'kansas city ',
  'gb ': 'green bay ',
  'lv ': 'las vegas ',
  'ne ': 'new england ',
  'no ': 'new orleans ',
  'nj ': 'new jersey ',
  'tb ': 'tampa bay ',
  // Nicknames
  'philly ': 'philadelphia ',
  'sixers ': '76ers ',
}

export function canonicalEventKey(event: Pick<CanonicalEvent, 'leagueSlug' | 'homeTeam' | 'awayTeam' | 'startTime'>): string {
  const normalizeTeam = (name: string) => {
    let n = (name || '').toLowerCase().trim()
    // Strip parentheticals (MLB adapters sometimes append pitcher names
    // like "New York Yankees (Gerrit Cole)"). Must match worker's
    // canonical.ts exactly so both sides produce the same key.
    n = n.replace(/\s*\(.*?\)\s*/g, ' ').trim().replace(/\s+/g, ' ')
    // Expand city abbreviations so "la clippers" → "los angeles clippers"
    for (const [abbr, full] of Object.entries(TEAM_CITY_ALIASES)) {
      if (n.startsWith(abbr)) {
        n = full + n.slice(abbr.length)
        break
      }
    }
    return n
  }
  // Parse through Date() so non-ISO startTime strings collapse to the
  // same UTC date both sides. Fall back to a raw slice if unparseable.
  const parsed = new Date(event.startTime)
  const date = isNaN(parsed.getTime())
    ? (event.startTime || '').slice(0, 10)
    : parsed.toISOString().slice(0, 10)
  // Sort alphabetically so "Away vs Home" and "Home vs Away" produce the same key
  const teams = [normalizeTeam(event.homeTeam), normalizeTeam(event.awayTeam)].sort()
  return `${event.leagueSlug}:${date}:${teams[0]}:${teams[1]}`
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
