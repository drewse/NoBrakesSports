// Shared per-league abbreviation → canonical full-name maps.
// Used to hydrate short team names ("BOS Red Sox", "NY Yankees") or raw
// symbols ("ATL") into the city+nickname shape our events table stores
// ("Atlanta Hawks", "New York Yankees"). Matching against canonical events
// fails without this hydration and auto-creates duplicate stub rows.

export const NBA_ABBR_TO_FULL: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets', CHA: 'Charlotte Hornets',
  CHO: 'Charlotte Hornets', CHI: 'Chicago Bulls', CLE: 'Cleveland Cavaliers', DAL: 'Dallas Mavericks',
  DEN: 'Denver Nuggets', DET: 'Detroit Pistons', GSW: 'Golden State Warriors', GS: 'Golden State Warriors',
  HOU: 'Houston Rockets', IND: 'Indiana Pacers', LAC: 'Los Angeles Clippers', LAL: 'Los Angeles Lakers',
  MEM: 'Memphis Grizzlies', MIA: 'Miami Heat', MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves',
  NOP: 'New Orleans Pelicans', NO: 'New Orleans Pelicans', NYK: 'New York Knicks', NY: 'New York Knicks',
  OKC: 'Oklahoma City Thunder', ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns',
  PHO: 'Phoenix Suns', POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs',
  SA: 'San Antonio Spurs', TOR: 'Toronto Raptors', UTA: 'Utah Jazz', UTH: 'Utah Jazz',
  WAS: 'Washington Wizards', WSH: 'Washington Wizards',
}

export const MLB_ABBR_TO_FULL: Record<string, string> = {
  ARI: 'Arizona Diamondbacks', AZ: 'Arizona Diamondbacks', ATL: 'Atlanta Braves', BAL: 'Baltimore Orioles',
  BOS: 'Boston Red Sox', CHC: 'Chicago Cubs', CHW: 'Chicago White Sox', CWS: 'Chicago White Sox',
  CIN: 'Cincinnati Reds', CLE: 'Cleveland Guardians', COL: 'Colorado Rockies', DET: 'Detroit Tigers',
  HOU: 'Houston Astros', KC: 'Kansas City Royals', KCR: 'Kansas City Royals',
  LAA: 'Los Angeles Angels', ANA: 'Los Angeles Angels', LAD: 'Los Angeles Dodgers', LA: 'Los Angeles Dodgers',
  MIA: 'Miami Marlins', FLA: 'Miami Marlins', MIL: 'Milwaukee Brewers', MIN: 'Minnesota Twins',
  NYM: 'New York Mets', NYY: 'New York Yankees', OAK: 'Oakland Athletics', ATH: 'Oakland Athletics',
  PHI: 'Philadelphia Phillies', PIT: 'Pittsburgh Pirates', SD: 'San Diego Padres', SDP: 'San Diego Padres',
  SEA: 'Seattle Mariners', SF: 'San Francisco Giants', SFG: 'San Francisco Giants',
  STL: 'St. Louis Cardinals', TB: 'Tampa Bay Rays', TBR: 'Tampa Bay Rays',
  TEX: 'Texas Rangers', TOR: 'Toronto Blue Jays', WSH: 'Washington Nationals', WAS: 'Washington Nationals',
}

export const NHL_ABBR_TO_FULL: Record<string, string> = {
  ANA: 'Anaheim Ducks', ARI: 'Arizona Coyotes', BOS: 'Boston Bruins', BUF: 'Buffalo Sabres',
  CGY: 'Calgary Flames', CAR: 'Carolina Hurricanes', CHI: 'Chicago Blackhawks', COL: 'Colorado Avalanche',
  CBJ: 'Columbus Blue Jackets', DAL: 'Dallas Stars', DET: 'Detroit Red Wings', EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers', LAK: 'Los Angeles Kings', LA: 'Los Angeles Kings',
  MIN: 'Minnesota Wild', MTL: 'Montreal Canadiens', NSH: 'Nashville Predators',
  NJD: 'New Jersey Devils', NJ: 'New Jersey Devils', NYI: 'New York Islanders', NYR: 'New York Rangers',
  OTT: 'Ottawa Senators', PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins',
  SEA: 'Seattle Kraken', SJ: 'San Jose Sharks', SJS: 'San Jose Sharks', STL: 'St. Louis Blues',
  TBL: 'Tampa Bay Lightning', TB: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs',
  UTA: 'Utah Hockey Club', VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights',
  WSH: 'Washington Capitals', WPG: 'Winnipeg Jets',
}

export const NFL_ABBR_TO_FULL: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers',
  HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LVR: 'Las Vegas Raiders',
  LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints',
  NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers',
  SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans', WAS: 'Washington Commanders', WSH: 'Washington Commanders',
}

export const ABBR_MAPS: Record<string, Record<string, string>> = {
  NBA: NBA_ABBR_TO_FULL, MLB: MLB_ABBR_TO_FULL, NHL: NHL_ABBR_TO_FULL, NFL: NFL_ABBR_TO_FULL,
  nba: NBA_ABBR_TO_FULL, mlb: MLB_ABBR_TO_FULL, nhl: NHL_ABBR_TO_FULL, nfl: NFL_ABBR_TO_FULL,
}

/** Hydrate a short team name ("BOS Red Sox", "NY Yankees") into the
 *  canonical "City Nickname" form by looking up the abbreviation prefix.
 *  Disambiguates shared abbreviations (e.g. "NY") via nickname suffix
 *  match — "NY Yankees" picks the MLB entry whose full name ends in
 *  "Yankees" rather than "Mets".
 *
 *  If no match, returns the input unchanged. */
export function hydrateTeamName(name: string, league: string): string {
  if (!name) return name
  const map = ABBR_MAPS[league] ?? ABBR_MAPS[league.toLowerCase()]
  if (!map) return name
  // Try a direct abbreviation lookup first — "BOS" on its own gives us
  // "Boston Red Sox" without needing the nickname.
  const direct = map[name.toUpperCase()]
  if (direct) return direct
  // "{ABBR} {nickname}" format — strip abbr prefix and disambiguate.
  const m = name.match(/^([A-Z]{2,3})\s+(.+)$/)
  if (m) {
    const [, abbr, nickname] = m
    const up = abbr.toUpperCase()
    const exact = map[up]
    if (exact && exact.toLowerCase().endsWith(nickname.toLowerCase())) return exact
    // Fall back: search for a team whose canonical name ends in the
    // nickname ("Yankees" → "New York Yankees").
    const nn = nickname.toLowerCase()
    for (const full of Object.values(map)) {
      if (full.toLowerCase().endsWith(nn)) return full
    }
  }
  return name
}
