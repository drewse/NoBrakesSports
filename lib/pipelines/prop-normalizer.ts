/**
 * Prop category mapping and player name normalization.
 *
 * Both Kambi and Pinnacle use different labels for the same prop category.
 * This module maps source-specific labels to canonical categories so
 * cross-book comparison works ("Points scored by the player" from Kambi
 * matches "Player Props: Points" from Pinnacle).
 */

// ── Canonical prop category type ─────────────────────────────────────────────

export interface NormalizedProp {
  propCategory: string    // canonical: 'player_points', 'player_rebounds', etc.
  playerName: string      // normalized: "LeBron James"
  lineValue: number | null
  overPrice: number | null
  underPrice: number | null
  yesPrice: number | null
  noPrice: number | null
  isBinary: boolean
}

// ── Kambi criterion label → canonical category ───────────────────────────────

const KAMBI_CATEGORY_MAP: Record<string, string> = {
  // Basketball
  'points scored by the player - including overtime': 'player_points',
  'points scored by the player': 'player_points',
  'rebounds by the player - including overtime': 'player_rebounds',
  'rebounds by the player': 'player_rebounds',
  'assists by the player': 'player_assists',
  'assists by the player - including overtime': 'player_assists',
  '3-point field goals made by the player - including overtime': 'player_threes',
  '3-point field goals made by the player': 'player_threes',
  'points, rebounds & assists by the player - including overtime': 'player_pts_reb_ast',
  'points, rebounds & assists by the player': 'player_pts_reb_ast',
  'to record a double-double - including overtime': 'player_double_double',
  'to record a double-double': 'player_double_double',
  'to record a triple-double - including overtime': 'player_triple_double',
  'to record a triple-double': 'player_triple_double',

  // Baseball
  'hits by the player': 'player_hits',
  'home runs by the player': 'player_home_runs',
  'rbis by the player': 'player_rbis',
  'strikeouts by the pitcher': 'player_strikeouts_p',
  'earned runs allowed by the pitcher': 'player_earned_runs',
  'total bases by the player': 'player_total_bases',
  'runs scored by the player': 'player_runs',
  'stolen bases by the player': 'player_stolen_bases',
  'walks by the player': 'player_walks',
  'hits allowed by the pitcher': 'player_hits_allowed',
  'outs recorded by the pitcher': 'pitcher_outs',

  // Hockey
  'goals by the player': 'player_goals',
  'assists by the player - ice hockey': 'player_hockey_assists',
  'points by the player - ice hockey': 'player_hockey_points',
  'shots on goal by the player': 'player_shots_on_goal',
  'saves by the goalkeeper': 'player_saves',
  'anytime goalscorer': 'anytime_goal_scorer',

  // Soccer
  'goals scored by the player': 'player_soccer_goals',
  'anytime goal scorer': 'anytime_scorer',
  'shots on target by the player': 'player_shots_target',

  // Game-level props
  'total points - 1st half': 'half_total',
  'total points - quarter 1': 'quarter_total',
  'total points - quarter 2': 'quarter_total',
  'total points - quarter 3': 'quarter_total',
  'total points - quarter 4': 'quarter_total',
  'handicap - 1st half': 'half_spread',
  'winning margin - including overtime': 'winning_margin',
  'winning margin': 'winning_margin',
}

// Binary prop patterns: these Kambi labels are yes/no bets
const KAMBI_BINARY_PATTERNS = [
  /^\d+\+.*by the player/i,
  /to record a (double|triple)/i,
  /anytime.*scorer/i,
  /first.*to.*score/i,
  /player to score the first/i,
]

// Team total patterns
const KAMBI_TEAM_TOTAL_PATTERN = /^total points by (.+?) - /i

/**
 * Map a Kambi criterion label to a canonical prop category.
 * Returns null if the label isn't a prop we track.
 */
export function mapKambiCategory(label: string): { category: string; isBinary: boolean } | null {
  // Strip common Kambi suffixes before matching:
  //   " - Including Extra Innings (Listed player must be in starting lineup for bets to stand)"
  //   " - Including Overtime"
  //   " (Includes Overtime)"
  //   trailing parenthetical notes
  let lower = label.toLowerCase().trim()
    .replace(/\s*-\s*including\s+(extra\s+innings|overtime).*$/i, '')
    .replace(/\s*\(includes?\s+overtime\)\s*$/i, '')
    .replace(/\s*\(listed player.*?\)\s*$/i, '')
    .trim()

  // Direct mapping
  const direct = KAMBI_CATEGORY_MAP[lower]
  if (direct) {
    const isBinary = KAMBI_BINARY_PATTERNS.some(p => p.test(label))
    return { category: direct, isBinary }
  }

  // Baseball-specific patterns — Kambi uses "Total X by the Player" format
  if (/^total\s+hits\s+by\s+the\s+player/i.test(lower)) return { category: 'player_hits', isBinary: false }
  if (/^total\s+rbis\s+by\s+the\s+player/i.test(lower)) return { category: 'player_rbis', isBinary: false }
  if (/^total\s+runs\s+scored\s+by\s+the\s+player/i.test(lower)) return { category: 'player_runs', isBinary: false }
  if (/^total\s+bases.*by\s+the\s+player/i.test(lower)) return { category: 'player_total_bases', isBinary: false }
  if (/^total\s+stolen\s+bases\s+by\s+the\s+player/i.test(lower)) return { category: 'player_stolen_bases', isBinary: false }
  if (/^total\s+walks\s+by\s+the\s+player/i.test(lower)) return { category: 'player_walks', isBinary: false }
  if (/^total\s+strikeouts.*pitcher/i.test(lower)) return { category: 'player_strikeouts_p', isBinary: false }
  if (/^total\s+earned\s+runs.*pitcher/i.test(lower)) return { category: 'player_earned_runs', isBinary: false }
  if (/^total\s+hits\s+allowed.*pitcher/i.test(lower)) return { category: 'player_hits_allowed', isBinary: false }
  if (/^total\s+outs\s+recorded.*pitcher/i.test(lower)) return { category: 'pitcher_outs', isBinary: false }
  // "Player to Hit a Home Run" — binary
  if (/^player\s+to\s+hit\s+a\s+home\s+run/i.test(lower)) return { category: 'player_home_runs', isBinary: true }
  // "Player to hit N or more Home Runs" — binary
  if (/^player\s+to\s+hit\s+\d+\s+or\s+more\s+home\s+runs/i.test(lower)) return { category: 'player_home_runs', isBinary: true }
  // "Total Home Runs by the Player"
  if (/^total\s+home\s+runs\s+by\s+the\s+player/i.test(lower)) return { category: 'player_home_runs', isBinary: false }

  // Binary prop patterns (e.g. "20+ Points Scored By The Player")
  if (KAMBI_BINARY_PATTERNS.some(p => p.test(label))) {
    // Extract the stat type from the label
    if (/points.*scored/i.test(label)) return { category: 'player_points', isBinary: true }
    if (/rebounds/i.test(label)) return { category: 'player_rebounds', isBinary: true }
    if (/assists/i.test(label)) return { category: 'player_assists', isBinary: true }
    if (/three.?point|3.?point/i.test(label)) return { category: 'player_threes', isBinary: true }
    if (/steals.*blocks/i.test(label)) return { category: 'player_steals', isBinary: true }
    if (/steals/i.test(label)) return { category: 'player_steals', isBinary: true }
    if (/blocks/i.test(label)) return { category: 'player_blocks', isBinary: true }
    if (/points.*rebounds.*assists/i.test(label)) return { category: 'player_pts_reb_ast', isBinary: true }
    if (/points.*rebounds/i.test(label)) return { category: 'player_points', isBinary: true }
    if (/points.*assists/i.test(label)) return { category: 'player_points', isBinary: true }
    if (/rebounds.*assists/i.test(label)) return { category: 'player_rebounds', isBinary: true }
    if (/goal/i.test(label)) return { category: 'anytime_goal_scorer', isBinary: true }
    if (/double/i.test(label)) return { category: 'player_double_double', isBinary: true }
    if (/triple/i.test(label)) return { category: 'player_triple_double', isBinary: true }
    return null
  }

  // Team total
  if (KAMBI_TEAM_TOTAL_PATTERN.test(label)) {
    return { category: 'team_total', isBinary: false }
  }

  return null
}

// ── Pinnacle special.description → canonical category ────────────────────────

const PINNACLE_CATEGORY_MAP: Record<string, string> = {
  'points': 'player_points',
  'rebounds': 'player_rebounds',
  'assists': 'player_assists',
  'threes': 'player_threes',
  'threes made': 'player_threes',
  '3-pointers made': 'player_threes',
  '3-point fg': 'player_threes',
  'pts+rebs+asts': 'player_pts_reb_ast',
  'pts + rebs + asts': 'player_pts_reb_ast',
  'steals': 'player_steals',
  'blocks': 'player_blocks',
  'turnovers': 'player_turnovers',
  'double double': 'player_double_double',
  'triple double': 'player_triple_double',
  // Baseball
  'hits': 'player_hits',
  'home runs': 'player_home_runs',
  'rbis': 'player_rbis',
  'total bases': 'player_total_bases',
  'runs': 'player_runs',
  'stolen bases': 'player_stolen_bases',
  'walks': 'player_walks',
  'strikeouts': 'player_strikeouts_p',
  'earned runs': 'player_earned_runs',
  'hits allowed': 'player_hits_allowed',
  'outs': 'pitcher_outs',
  // Hockey
  'goals': 'player_goals',
  'shots on goal': 'player_shots_on_goal',
  'saves': 'player_saves',
  'power play points': 'player_power_play_pts',
  // Soccer
  'shots on target': 'player_shots_target',
}

// Substrings that identify a non-player (team / game) prop so the
// "Name Total Stat" regex doesn't false-match things like
// "Tampa Bay Rays Exact Total Runs" or "Paris SG Exact Total Goals".
const PINNACLE_NON_PLAYER_MARKERS = /\b(exact|odd\/even|range|winning|margin|1st\s*half|correct\s*score|both\s*teams|no\s*bet|race\s*to|first\s*team|handicap|team|winner|goalscorer)\b/i

/**
 * Map a Pinnacle special description to a canonical prop category.
 * Two observed description formats:
 *   NHL:  "Connor Hellebuyck (Saves)"         — parens around stat
 *   NBA:  "Jrue Holiday Total Assists"         — "Total" infix, no parens
 *   MLB:  "Aaron Judge Total Home Runs"        — same as NBA
 */
export function mapPinnacleCategory(description: string): { category: string; playerName: string } | null {
  // Format 1: "Player Name (Stat)"
  const parenMatch = description.match(/^(.+?)\s*\((.+?)\)\s*$/)
  if (parenMatch) {
    const [, rawPlayer, rawStat] = parenMatch
    const category = PINNACLE_CATEGORY_MAP[rawStat.toLowerCase().trim()]
    if (category) return { category, playerName: normalizePlayerName(rawPlayer) }
  }
  // Format 2: "Player Name Total {Stat}"
  const totalMatch = description.match(/^(.+?)\s+Total\s+(.+?)$/i)
  if (totalMatch) {
    const [, rawPlayer, rawStat] = totalMatch
    // Reject team / game props that also contain " Total ".
    if (PINNACLE_NON_PLAYER_MARKERS.test(rawPlayer)) return null
    // Require a player-shaped prefix (2-3 words, each starting uppercase).
    // Stops "Paris Saint-Germain" and other team names from slipping
    // through when their Total-Goals market is labeled similarly.
    const words = rawPlayer.trim().split(/\s+/)
    if (words.length < 2 || words.length > 4) return null
    const category = PINNACLE_CATEGORY_MAP[rawStat.toLowerCase().trim()]
    if (category) return { category, playerName: normalizePlayerName(rawPlayer) }
  }
  return null
}

// ── Player name normalization ────────────────────────────────────────────────

/**
 * Normalize player names for cross-book matching.
 *
 * Books format names differently:
 *   Kambi:     "CJ McCollum", "Dyson Daniels"
 *   Pinnacle:  "CJ McCollum", "Dyson Daniels"
 *   Odds API:  "C.J. McCollum"
 *
 * We normalize to: Title Case, no periods in initials, trim whitespace.
 */
export function normalizePlayerName(name: string): string {
  return name
    .trim()
    // Remove periods from initials: "C.J." → "CJ"
    .replace(/\.(?=[A-Z])/g, '')
    // Remove trailing periods
    .replace(/\.$/, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    // Ensure title case for each word
    .split(' ')
    .map(w => {
      // Preserve "Mc" and "O'" prefixes
      if (/^mc/i.test(w)) return 'Mc' + w.slice(2, 3).toUpperCase() + w.slice(3).toLowerCase()
      if (/^o'/i.test(w)) return "O'" + w.slice(2, 3).toUpperCase() + w.slice(3).toLowerCase()
      // Handle suffixes
      if (/^(jr|sr|ii|iii|iv)$/i.test(w)) return w.toUpperCase()
      // Standard title case
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

/**
 * Compute an odds hash for a prop row (for change detection).
 */
export function computePropOddsHash(
  overPrice: number | null,
  underPrice: number | null,
  yesPrice: number | null,
  noPrice: number | null,
): string {
  return [overPrice, underPrice, yesPrice, noPrice]
    .map(v => v ?? '')
    .join('|')
}

/**
 * Convert American odds to implied probability.
 */
export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100)
  return -odds / (-odds + 100)
}
