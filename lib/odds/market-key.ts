/**
 * Normalized market selection key system for the /odds page.
 *
 * Hierarchy:  Sport → League → Market → [Stat] → Period
 *
 * The stat level is CONDITIONAL — it only applies to
 * Total / TeamTotal / PlayerProps. Moneyline and Spread skip it.
 *
 * The selection encodes as a single string via keyFromSelection()
 * so caches, URLs, and websocket channels all share one identifier.
 * Example: "basketball:nba:moneyline:full" or
 *          "basketball:nba:player_props:points:q1".
 */

export type SportId =
  | 'basketball' | 'baseball' | 'hockey' | 'football' | 'soccer' | 'tennis'

export type MarketId =
  | 'moneyline' | 'spread' | 'total' | 'team_total' | 'player_props'

export type PeriodId =
  | 'full' | '1h' | '2h' | 'q1' | 'q2' | 'q3' | 'q4'
  | 'end_of_q3' | 'both_halves' | 'either_half'

export interface MarketSelection {
  sport: SportId
  league: string          // e.g. 'nba', 'wnba', 'mlb', 'nhl'
  market: MarketId
  stat?: string           // required when market in { total, team_total, player_props }
  period: PeriodId
}

// ─────────────────────────────────────────────────────────────────────
// Config — what's available per sport

export const SPORTS: { id: SportId; label: string }[] = [
  { id: 'basketball', label: 'Basketball' },
  { id: 'baseball',   label: 'Baseball' },
  { id: 'hockey',     label: 'Hockey' },
  { id: 'football',   label: 'Football' },
  { id: 'soccer',     label: 'Soccer' },
  { id: 'tennis',     label: 'Tennis' },
]

export const LEAGUES_BY_SPORT: Record<SportId, { slug: string; label: string }[]> = {
  basketball: [
    { slug: 'nba',           label: 'NBA' },
    { slug: 'nba_preseason', label: 'NBA Preseason' },
    { slug: 'wnba',          label: 'WNBA' },
    { slug: 'ncaab',         label: 'NCAAB' },
  ],
  baseball: [
    { slug: 'mlb', label: 'MLB' },
  ],
  hockey: [
    { slug: 'nhl', label: 'NHL' },
  ],
  football: [
    { slug: 'nfl',     label: 'NFL' },
    { slug: 'ncaaf',   label: 'NCAAF' },
  ],
  soccer: [
    { slug: 'epl',           label: 'Premier League' },
    { slug: 'laliga',        label: 'La Liga' },
    { slug: 'bundesliga',    label: 'Bundesliga' },
    { slug: 'seria_a',       label: 'Serie A' },
    { slug: 'ligue_one',     label: 'Ligue 1' },
    { slug: 'liga_mx',       label: 'Liga MX' },
    { slug: 'mls',           label: 'MLS' },
    { slug: 'ucl',           label: 'Champions League' },
  ],
  tennis: [
    { slug: 'atp', label: 'ATP' },
    { slug: 'wta', label: 'WTA' },
  ],
}

export const MARKETS: { id: MarketId; label: string }[] = [
  { id: 'moneyline',    label: 'Moneyline' },
  { id: 'spread',       label: 'Spread' },
  { id: 'total',        label: 'Total' },
  { id: 'team_total',   label: 'Team Total' },
  { id: 'player_props', label: 'Player Props' },
]

/** Which markets require a stat pick. */
export const MARKETS_WITH_STAT: ReadonlySet<MarketId> = new Set<MarketId>([
  'total', 'team_total', 'player_props',
])

/**
 * Stat catalog per sport. The same stat string means different things in
 * Total / Team Total / Player Props context — the UI shows the same list.
 * Stat IDs correspond to prop_odds.prop_category for player props
 * (e.g. 'player_points'); for game/team totals the stat is encoded in
 * market_type (e.g. 'total', 'team_total') plus we infer the stat from
 * the league (NBA total = points, MLB total = runs, NHL total = goals,
 * etc.), so for those the stat picker is visual-only for now.
 */
export const STATS_BY_SPORT: Record<SportId, { id: string; label: string }[]> = {
  basketball: [
    { id: 'points',         label: 'Points' },
    { id: 'rebounds',       label: 'Rebounds' },
    { id: 'assists',        label: 'Assists' },
    { id: 'threes',         label: '3-Pointers' },
    { id: 'pts_reb_ast',    label: 'Pts + Reb + Ast' },
    { id: 'pts_reb',        label: 'Pts + Reb' },
    { id: 'pts_ast',        label: 'Pts + Ast' },
    { id: 'ast_reb',        label: 'Reb + Ast' },
    { id: 'double_double',  label: 'Double Double' },
    { id: 'triple_double',  label: 'Triple Double' },
    { id: 'turnovers',      label: 'Turnovers' },
    { id: 'steals',         label: 'Steals' },
    { id: 'blocks',         label: 'Blocks' },
    { id: 'steals_blocks',  label: 'Stl + Blk' },
    { id: 'first_basket',   label: 'First Basket' },
  ],
  baseball: [
    { id: 'hits',           label: 'Hits' },
    { id: 'home_runs',      label: 'Home Runs' },
    { id: 'rbis',           label: 'RBIs' },
    { id: 'runs',           label: 'Runs' },
    { id: 'total_bases',    label: 'Total Bases' },
    { id: 'stolen_bases',   label: 'Stolen Bases' },
    { id: 'walks',          label: 'Walks' },
    { id: 'strikeouts_p',   label: 'Pitcher Ks' },
    { id: 'earned_runs',    label: 'Earned Runs' },
    { id: 'pitcher_outs',   label: 'Pitcher Outs' },
    { id: 'hits_allowed',   label: 'Hits Allowed' },
  ],
  hockey: [
    { id: 'goals',          label: 'Goals' },
    { id: 'shots_on_goal',  label: 'Shots on Goal' },
    { id: 'saves',          label: 'Saves' },
    { id: 'hockey_assists', label: 'Assists' },
    { id: 'hockey_points',  label: 'Points' },
    { id: 'power_play_pts', label: 'Power Play Pts' },
  ],
  football: [
    { id: 'pass_yds',       label: 'Passing Yards' },
    { id: 'pass_td',        label: 'Passing TDs' },
    { id: 'rush_yds',       label: 'Rushing Yards' },
    { id: 'rec_yds',        label: 'Receiving Yards' },
    { id: 'receptions',     label: 'Receptions' },
    { id: 'anytime_td',     label: 'Anytime TD' },
  ],
  soccer: [
    { id: 'soccer_goals',   label: 'Goals' },
    { id: 'shots_target',   label: 'Shots on Target' },
    { id: 'anytime_scorer', label: 'Anytime Scorer' },
  ],
  tennis: [
    { id: 'aces',           label: 'Aces' },
    { id: 'double_faults',  label: 'Double Faults' },
  ],
}

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: 'full',         label: 'Full Game' },
  { id: '1h',           label: '1st Half' },
  { id: '2h',           label: '2nd Half' },
  { id: 'q1',           label: '1st Quarter' },
  { id: 'q2',           label: '2nd Quarter' },
  { id: 'q3',           label: '3rd Quarter' },
  { id: 'q4',           label: '4th Quarter' },
  { id: 'end_of_q3',    label: 'End of 3rd Quarter' },
  { id: 'both_halves',  label: 'Both Halves' },
  { id: 'either_half',  label: 'Either Half' },
]

// ─────────────────────────────────────────────────────────────────────
// Key codec + URL params

export function keyFromSelection(s: MarketSelection): string {
  const parts = [s.sport, s.league, s.market]
  if (MARKETS_WITH_STAT.has(s.market) && s.stat) parts.push(s.stat)
  parts.push(s.period)
  return parts.join(':')
}

/**
 * Parse URL searchParams into a MarketSelection. Missing or invalid values
 * fall back to a sane default. Caller should re-encode to URL so the UI
 * and the key always agree.
 */
export function selectionFromParams(
  params: Record<string, string | undefined>,
): MarketSelection {
  const sport  = (params.sport as SportId) ?? 'basketball'
  const league = params.league ?? LEAGUES_BY_SPORT[sport]?.[0]?.slug ?? 'nba'
  const market = (params.market as MarketId) ?? 'moneyline'
  const stat   = params.stat
  const period = (params.period as PeriodId) ?? 'full'
  return {
    sport,
    league,
    market,
    stat: MARKETS_WITH_STAT.has(market) ? (stat ?? STATS_BY_SPORT[sport]?.[0]?.id) : undefined,
    period,
  }
}

export function paramsFromSelection(s: MarketSelection): Record<string, string> {
  const out: Record<string, string> = {
    sport: s.sport,
    league: s.league,
    market: s.market,
    period: s.period,
  }
  if (s.stat) out.stat = s.stat
  return out
}

// ─────────────────────────────────────────────────────────────────────
// DB mapping — selection → (table + market_type / prop_category filter)

export interface OddsQueryPlan {
  /** Which DB table to read odds from. */
  table: 'current_market_odds' | 'prop_odds'
  /** Column filter on that table. For `current_market_odds` this is
   *  `market_type` (e.g. 'moneyline', 'spread', 'total', 'team_total',
   *  and period-suffixed variants like 'moneyline_h1'). For `prop_odds`
   *  this is `prop_category` (e.g. 'player_points'). */
  column: 'market_type' | 'prop_category'
  value: string
  /** Hint for UI: 2-column (home/away) vs over/under. */
  sideShape: 'home_away' | 'over_under'
}

/**
 * Resolve a MarketSelection into the DB query plan. Returns null if the
 * selection isn't supported by the current schema yet (e.g. player
 * props by quarter — prop_odds has no period column today).
 */
export function planForSelection(s: MarketSelection): OddsQueryPlan | null {
  const periodSuffix =
    s.period === 'full' ? '' :
    s.period === '1h'   ? '_h1' :
    s.period === '2h'   ? '_h2' :
    s.period === 'q1'   ? '_q1' :
    s.period === 'q2'   ? '_q2' :
    s.period === 'q3'   ? '_q3' :
    s.period === 'q4'   ? '_q4' :
    ''

  if (s.market === 'moneyline' || s.market === 'spread') {
    return {
      table: 'current_market_odds',
      column: 'market_type',
      value: `${s.market}${periodSuffix}`,
      sideShape: s.market === 'moneyline' ? 'home_away' : 'home_away',
    }
  }
  if (s.market === 'total') {
    return {
      table: 'current_market_odds',
      column: 'market_type',
      value: `total${periodSuffix}`,
      sideShape: 'over_under',
    }
  }
  if (s.market === 'team_total') {
    // period-suffixed team totals not currently stored
    if (periodSuffix) return null
    return {
      table: 'current_market_odds',
      column: 'market_type',
      value: 'team_total',
      sideShape: 'over_under',
    }
  }
  if (s.market === 'player_props' && s.stat) {
    // prop_odds has no period column today — only full-game props supported.
    if (s.period !== 'full') return null
    return {
      table: 'prop_odds',
      column: 'prop_category',
      value: `player_${s.stat}`,
      sideShape: 'over_under',
    }
  }
  return null
}
