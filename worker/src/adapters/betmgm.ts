/**
 * BetMGM (Ontario) — real adapter (Entain CDS).
 *
 * The BetMGM SPA fires against www.on.betmgm.ca/cds-api/bettingoffer/*.
 * The key endpoint is /cds-api/bettingoffer/fixtures — inline events +
 * markets (moneyline/spread/total) + american odds. Public, no auth;
 * x-bwin-accessid in the query string gates access.
 *
 * Strategy: load the NBA league page once so the Entain CDN issues a
 * session cookie (GeoGuard / Akamai BMS sometimes gates it), then call
 * the fixture endpoints from inside the page context (inherits cookies
 * + TLS fingerprint).
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedProp } from '../lib/types.js'

// ── Prop category detection ─────────────────────────────────────────
//
// BetMGM (Entain) prop labels observed from the live diag:
//   "Donovan Mitchell - Rebounds"
//   "James Harden - Three Pointers"
//   "Cade Cunningham - Points"
//   "Bryan Reynolds - Runs"
//   "Konnor Griffin - Player triples"
//   "Willson Contreras to record 1+ hits"          (binary threshold)
//   "Ceddanne Rafaela: Strikeouts"                  (colon variant)
//   "Donovan Mitchell to score 30+ points"          (binary threshold)
//   "Joel Embiid to record 5+ assists"              (binary threshold)
//   "Joel Embiid to record 25+ Total Points and Rebounds"  (combo)

const BMG_PROP_KEYWORDS: Array<{ re: RegExp; category: string }> = [
  // ── NHL-specific BEFORE generic NBA "points/assists/goals" ─────────
  // BetMGM ships hockey "Player (TB): points" / "(TB): assists" with
  // the same "points/assists" labels NBA uses. Detect hockey-specific
  // stats first via more-specific keywords. "Powerplay Points" must
  // match before bare "points" or it'll be miscategorised as basketball.
  { re: /\bpower\s*play\s*points?\b|\bpp\s*points?\b/i, category: 'player_power_play_pts' },
  { re: /\bshots?\s*on\s*goal\b/i, category: 'player_shots_on_goal' },
  // Combos must come first so single-stat substring checks don't swallow them
  { re: /\bpoints?\s*[,+]?\s*rebounds?\s*[,+]?\s*(and\s+)?assists?\b/i, category: 'player_pts_reb_ast' },
  { re: /\bpoints?\s*and\s*rebounds?\b/i, category: 'player_pts_reb' },
  { re: /\bpoints?\s*and\s*assists?\b/i, category: 'player_pts_ast' },
  { re: /\brebounds?\s*and\s*assists?\b/i, category: 'player_ast_reb' },
  { re: /\bsteals?\s*and\s*blocks?\b/i, category: 'player_steals_blocks' },
  // NBA singles
  { re: /\bthree\s*pointers?\b|\b3-?pointers?\b/i, category: 'player_threes' },
  { re: /\bturnovers?\b/i, category: 'player_turnovers' },
  { re: /\bsteals?\b/i, category: 'player_steals' },
  { re: /\bblocks?\b/i, category: 'player_blocks' },
  { re: /\brebounds?\b/i, category: 'player_rebounds' },
  { re: /\bassists?\b/i, category: 'player_assists' },
  { re: /\bpoints?\b/i, category: 'player_points' },
  // MLB — note "hits allowed" / "walks allowed" / "earned runs" must
  // match before bare "hits" / "walks" / "runs"
  { re: /\btotal\s*bases?\b/i, category: 'player_total_bases' },
  { re: /\bhome\s*runs?\b/i, category: 'player_home_runs' },
  { re: /\brbis?\b/i, category: 'player_rbis' },
  { re: /\b(walks?\s*allowed|pitcher\s*walks)\b/i, category: 'player_walks' },
  { re: /\bwalks?\b/i, category: 'player_walks' },
  { re: /\bstrikeouts?\b/i, category: 'player_strikeouts_p' },
  { re: /\bearned\s*runs?\b/i, category: 'player_earned_runs' },
  { re: /\bouts?\b/i, category: 'pitcher_outs' },
  { re: /\bhits?\s*allowed\b/i, category: 'player_hits_allowed' },
  { re: /\bhits?\b/i, category: 'player_hits' },
  { re: /\bstolen\s*bases?\b/i, category: 'player_stolen_bases' },
  { re: /\bruns?\b/i, category: 'player_runs' },
  // NHL singles AFTER MLB so "runs" / "hits" don't get hockey-coded.
  // BetMGM hockey labels: "Shots" alone (= shots on goal), "Goals",
  // "Saves", "Assists" (handled above).
  { re: /\bshots?\b/i, category: 'player_shots_on_goal' },
  { re: /\bsaves?\b/i, category: 'player_saves' },
  { re: /\bgoals?\b/i, category: 'player_goals' },
]

function detectBmgPropCategory(stat: string, leagueSlug: string): string | null {
  for (const { re, category } of BMG_PROP_KEYWORDS) {
    if (re.test(stat)) {
      // Sport-context disambiguation. NHL uses bare "Points" / "Assists"
      // labels for hockey points/assists, but the regex above maps those
      // to NBA categories. Remap to hockey equivalents when fixture is
      // an NHL game so cross-book pairing works.
      if (leagueSlug === 'nhl') {
        if (category === 'player_points') return 'player_hockey_points'
        if (category === 'player_assists') return 'player_hockey_assists'
      }
      return category
    }
  }
  return null
}

// Period-scoped market markers — these are NOT full-game props and would
// pair against full-game props from other books to produce phantom EV /
// arbs. Reject before any further parsing.
const BMG_PERIOD_SCOPED = /\b(1st|2nd|3rd|4th|first|second|third|fourth)\s+(period|half|quarter|inning|innings)\b|\bhalftime\b|\bfull\s*time\b|\bregular\s*time\b|\bot\s+only\b|\bfirst\s+\d+\s+(innings|periods|quarters|halves)\b|\b(periods?|halves|quarters|innings)\s*:\s*\d+\b/i

// Known team-name suffixes that BetMGM uses for team-level props like
// "Dallas Stars: 1st Period Goals". A real player name never ends with
// one of these tokens. Covers NHL / NBA / MLB / NFL.
const BMG_TEAM_SUFFIXES = new Set([
  // NHL
  'stars', 'wild', 'oilers', 'ducks', 'kings', 'sharks', 'flames', 'canucks',
  'jets', 'avalanche', 'blackhawks', 'blues', 'predators', 'wings', 'jackets',
  'penguins', 'flyers', 'rangers', 'islanders', 'devils', 'capitals', 'hurricanes',
  'panthers', 'lightning', 'senators', 'leafs', 'canadiens', 'bruins', 'sabres',
  'kraken', 'knights', 'club',
  // NBA
  'lakers', 'clippers', 'warriors', 'suns', 'nuggets', 'jazz', 'blazers',
  'timberwolves', 'thunder', 'rockets', 'mavericks', 'spurs', 'pelicans',
  'grizzlies', 'celtics', 'knicks', 'nets', '76ers', 'sixers', 'raptors',
  'bucks', 'pacers', 'bulls', 'pistons', 'cavaliers', 'hawks', 'hornets',
  'heat', 'magic', 'wizards',
  // MLB
  'yankees', 'mets', 'orioles', 'rays', 'jays', 'sox', 'guardians', 'tigers',
  'royals', 'twins', 'astros', 'angels', 'athletics', 'mariners', 'rangers',
  'braves', 'marlins', 'phillies', 'nationals', 'cubs', 'reds', 'brewers',
  'pirates', 'cardinals', 'diamondbacks', 'rockies', 'dodgers', 'padres',
  'giants',
])

/** Parse a BetMGM market name into (player, stat). Three shapes seen:
 *    "<Player> - <Stat>"           (most common O/U)
 *    "<Player> (XX): <Stat>"       (player-with-team-abbrev)
 *    "<Player> (XX) : <Stat>"      (variant with space before colon)
 *    "<Player>: <Stat>"            (no team abbrev)
 *    "<Player> to <verb> <N>+ <Stat>"  (threshold/binary)
 *
 * Returns null for period-scoped markets and team-level markets so we
 * don't pollute prop_odds with phantom rows.
 */
function parseBmgPropName(name: string): { player: string; stat: string; isThreshold: boolean } | null {
  if (!name) return null
  // Reject period-scoped markets entirely. They aren't comparable to
  // the full-game props other books ship and the +EV / arb scanners
  // pair them as if they were. Logged from the live diag:
  //   "1st period goals", "2nd period winner", "First 5 innings: Moneyline".
  if (BMG_PERIOD_SCOPED.test(name)) return null
  // Threshold form first ("Player to record 25+ ...")
  const thresh = name.match(/^(.+?)\s+to\s+(?:get|score|record|make|throw|hit|have)\s+\d+\+\s+(.+)$/i)
  if (thresh) {
    const stripped = stripTeamAbbrev(thresh[1].trim())
    return { player: stripped, stat: thresh[2].trim(), isThreshold: true }
  }
  // Dash separator (last " - " in case stat contains dashes like "Three-Pointers Made")
  const dashIdx = name.lastIndexOf(' - ')
  if (dashIdx > 0) {
    const player = stripTeamAbbrev(name.slice(0, dashIdx).trim())
    return { player, stat: name.slice(dashIdx + 3).trim(), isThreshold: false }
  }
  // Colon separator. Allow optional space before the colon since
  // BetMGM ships both "Player (TB): Shots" and "Player (TB) : Shots".
  const colonMatch = name.match(/^(.+?)\s*:\s+(.+)$/)
  if (colonMatch) {
    const player = stripTeamAbbrev(colonMatch[1].trim())
    return { player, stat: colonMatch[2].trim(), isThreshold: false }
  }
  return null
}

/** Strip BetMGM's "(XXX)" team abbreviation suffix from a player name.
 *  E.g. "Brayden Point (TB)" → "Brayden Point". */
function stripTeamAbbrev(s: string): string {
  return s.replace(/\s*\([A-Za-z]{2,5}\)\s*$/, '').trim()
}

/** Title-case a BetMGM player name. The diag log showed BetMGM ships
 *  names lowercased ("cj mccollum"); other books ship "CJ McCollum",
 *  so cross-book pairing fails on raw player_name. Title-case here so
 *  DB rows match other books' normalization. Preserves "Mc"/"O'"/
 *  suffix conventions. */
function normalizeBmgPlayerName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (/^mc/i.test(w) && w.length > 2) return 'Mc' + w.charAt(2).toUpperCase() + w.slice(3).toLowerCase()
      if (/^o'/i.test(w) && w.length > 2) return "O'" + w.charAt(2).toUpperCase() + w.slice(3).toLowerCase()
      if (/^(jr|sr|ii|iii|iv|v)\.?$/i.test(w)) return w.toUpperCase().replace(/\./g, '')
      // CJ / TJ / DJ — preserve as initials when a 2-letter all-caps token appears
      if (/^[a-z]{2}$/i.test(w) && w.length === 2) return w.toUpperCase()
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(' ')
}

function looksLikePlayerName(s: string): boolean {
  if (!s || s.length < 3 || s.length > 60) return false
  // Reject team-level markets like "Dallas Stars" / "Edmonton Oilers"
  // by checking the last word against a known team-suffix list.
  const tokens = s.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length >= 1) {
    const last = tokens[tokens.length - 1]
    if (BMG_TEAM_SUFFIXES.has(last)) return false
    // Also reject "white sox" / "red sox" / "blue jays" kind of pairs
    if (tokens.length >= 2) {
      const lastTwo = tokens.slice(-2).join(' ')
      if (/^(white sox|red sox|blue jays|maple leafs|trail blazers|golden knights|red wings|blue jackets)$/.test(lastTwo)) return false
    }
  }
  // Reject obvious non-player tokens
  if (/\b(home|away|over|under|yes|no|both|neither|tie|either|each|first|last|any|player|game)\b/i.test(s)
      && !/^[A-Z]/.test(s)) return false
  // Multi-word OR includes a hyphen (Karl-Anthony) — bare single-word names rare
  if (!/\s/.test(s) && !/-[A-Z]/.test(s)) return false
  return true
}

function extractFixtureProps(fixture: BMGFixture, leagueSlug: string): NormalizedProp[] {
  const out: NormalizedProp[] = []
  // Track (player, category, line) → prefer two-sided over one-sided
  const seen = new Map<string, NormalizedProp>()

  // Walk both optionMarkets and games[] — Entain CDS sometimes ships
  // player props under either depending on fixture type.
  const allMarkets: any[] = []
  for (const m of (fixture.optionMarkets ?? [])) allMarkets.push(m)
  for (const g of ((fixture as any)?.games ?? [])) allMarkets.push(g)

  for (const m of allMarkets) {
    const status = m?.status ?? m?.visibility ?? ''
    if (status && /suspended|closed|hidden|inactive|disabled/i.test(String(status))) continue
    const marketName: string = m?.name?.value ?? ''
    if (!marketName) continue
    const parsed = parseBmgPropName(marketName)
    if (!parsed) continue
    if (!looksLikePlayerName(parsed.player)) continue
    const category = detectBmgPropCategory(parsed.stat, leagueSlug)
    if (!category) continue

    const opts: any[] = m?.options ?? m?.results ?? []
    if (opts.length < 1) continue

    if (parsed.isThreshold) {
      // Binary "Yes/No" or single-side "<N>+" — skip since arbs need O/U
      // pairs. Could surface as binary props later, but for the user's
      // immediate request (game_total_hits arb pairing) this is moot.
      continue
    }

    // Standard O/U: collect over/under prices + line.
    let over: number | null = null, under: number | null = null, line: number | null = null
    for (const o of opts) {
      const optName: string = (o?.name?.value ?? '').toLowerCase()
      const american = Number(o?.price?.americanOdds ?? o?.americanOdds)
      if (!isFinite(american)) continue
      const totalsPrefix = o?.totalsPrefix
      const pts = Number(o?.points ?? o?.handicap)
      const attr = o?.attr != null ? Number(o.attr) : NaN
      const candidateLine = isFinite(pts) ? pts : isFinite(attr) ? attr : NaN
      if (totalsPrefix === 'Over' || optName.startsWith('over')) {
        over = american; if (line == null && isFinite(candidateLine)) line = candidateLine
      } else if (totalsPrefix === 'Under' || optName.startsWith('under')) {
        under = american; if (line == null && isFinite(candidateLine)) line = candidateLine
      }
    }
    // Fall back to market-level attr for the line if not found on options.
    if (line == null) {
      const mAttr = m?.attr != null ? Number(m.attr) : NaN
      if (isFinite(mAttr)) line = mAttr
    }
    if (line == null) continue
    if (over == null && under == null) continue

    const normalizedPlayer = normalizeBmgPlayerName(parsed.player)
    const key = `${normalizedPlayer}|${category}|${line}`
    const newBoth = over != null && under != null
    const existing = seen.get(key)
    const existingBoth = existing && existing.overPrice != null && existing.underPrice != null
    if (!existing || (newBoth && !existingBoth)) {
      seen.set(key, {
        propCategory: category,
        playerName: normalizedPlayer,
        lineValue: line,
        overPrice: over,
        underPrice: under,
        yesPrice: null,
        noPrice: null,
        isBinary: false,
      })
    }
  }
  for (const p of seen.values()) out.push(p)
  return out
}

const DOMAIN = 'www.on.betmgm.ca'
const ACCESS_ID = 'MzViOTU5Y2EtNzgyMy00ZTBmLThkNDctYjRlYjgwNjMwZDQy'
const COMMON_Q =
  `x-bwin-accessid=${ACCESS_ID}&lang=en-us&country=CA&userCountry=CA&subdivision=CA-Ontario`
const SEED_URL = `https://${DOMAIN}/en/sports/basketball-7/betting/usa-9/nba-6004`

interface League {
  sportId: number
  competitionId: number
  leagueSlug: string
  sport: string
  name: string
}

const LEAGUES: League[] = [
  { sportId: 7,  competitionId: 6004, leagueSlug: 'nba', sport: 'basketball', name: 'NBA' },
  { sportId: 23, competitionId: 75,   leagueSlug: 'mlb', sport: 'baseball',   name: 'MLB' },
  { sportId: 12, competitionId: 34,   leagueSlug: 'nhl', sport: 'ice_hockey', name: 'NHL' },
]

interface BMGOption {
  id?: number
  name?: { value?: string }
  sourceName?: { value?: string }
  price?: { americanOdds?: number; odds?: number }
  attr?: string
  totalsPrefix?: 'Over' | 'Under'
}

interface BMGMarket {
  name?: { value?: string }
  templateCategory?: { name?: { value?: string } }
  status?: string
  isMain?: boolean
  attr?: string
  options?: BMGOption[]
}

interface BMGFixture {
  id: string | number
  startDate?: string
  isOutright?: boolean
  isLive?: boolean
  competition?: { id?: number }
  participants?: Array<{
    name?: { value?: string }
    properties?: { type?: string }
  }>
  optionMarkets?: BMGMarket[]
}

function decimalToAmerican(d: number): number | null {
  if (!isFinite(d) || d <= 1) return null
  if (d >= 2) return Math.round((d - 1) * 100)
  return Math.round(-100 / (d - 1))
}

function americanFromOption(o: BMGOption | undefined): number | null {
  if (!o?.price) return null
  if (typeof o.price.americanOdds === 'number') return o.price.americanOdds
  if (typeof o.price.odds === 'number') return decimalToAmerican(o.price.odds)
  return null
}

function parseFixtureMarkets(
  fixture: BMGFixture,
  homeName: string,
  awayName: string,
): { markets: GameMarket[]; debug: { catNames: string[]; statuses: string[]; total: number } } {
  const out: GameMarket[] = []
  const homeKey = homeName.split(' ').pop()?.toLowerCase() ?? ''
  const awayKey = awayName.split(' ').pop()?.toLowerCase() ?? ''

  const catNamesSeen = new Set<string>()
  const statusesSeen = new Set<string>()
  let totalRaw = 0

  // Entain CDS ships full-game ML/spread/total under `fixture.games`
  // (catId 43=ML, 44=spread, 45=total), with results carrying
  // sourceName.value '1'/'2'/'3' for home/away/draw and americanOdds
  // flat on the result. The old code tried `optionMarkets` instead,
  // which is empty on the league fixtures list (verified from the
  // diagnostic log — fixturesWithEmptyOptionMarkets matched the
  // fixture count exactly). Port the SI/SIA parser pattern.
  const games: any[] = (fixture as any)?.games ?? []
  const sideOf = (r: any): 'home' | 'away' | 'draw' | 'over' | 'under' | null => {
    const src = r?.sourceName?.value ?? ''
    if (src === '1') return 'home'
    if (src === '2') return 'away'
    if (src === '3') return 'draw'
    const lab = (r?.name?.value ?? '').toLowerCase()
    if (lab.startsWith('over')) return 'over'
    if (lab.startsWith('under')) return 'under'
    if (homeKey && lab.includes(homeKey)) return 'home'
    if (awayKey && lab.includes(awayKey)) return 'away'
    return null
  }

  for (const game of games) {
    totalRaw++
    const visibility = game?.visibility
    if (visibility) statusesSeen.add(String(visibility))
    if (visibility && visibility !== 'Visible') continue
    const catId: number = game?.categoryId ?? game?.templateCategory?.id ?? 0
    const name: string = (game?.name?.value ?? '').toLowerCase()
    if (name) catNamesSeen.add(name)
    const results: any[] = (game?.results ?? []).filter((r: any) => !r?.visibility || r?.visibility === 'Visible')
    if (results.length < 2) continue

    // Moneyline (catId 43)
    if (!out.some(g => g.marketType === 'moneyline')
        && (catId === 43 || /^moneyline$|^money line$|^match result$/.test(name))) {
      let home: number | null = null, away: number | null = null, draw: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds ?? r?.price?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        if (s === 'home') home = p
        else if (s === 'away') away = p
        else if (s === 'draw') draw = p
      }
      if (home != null && away != null) {
        out.push({
          marketType: 'moneyline',
          homePrice: home, awayPrice: away, drawPrice: draw,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      }
    }
    // Spread (catId 44)
    else if (!out.some(g => g.marketType === 'spread')
        && (catId === 44 || /^spread$|^handicap$|^run line$|^puck line$|^point spread$/.test(name))) {
      let home: number | null = null, away: number | null = null, line: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds ?? r?.price?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        const pts = Number(r?.points ?? r?.handicap)
        if (s === 'home') { home = p; if (isFinite(pts)) line = pts }
        else if (s === 'away') { away = p; if (line == null && isFinite(pts)) line = -pts }
      }
      if (home != null || away != null) {
        out.push({
          marketType: 'spread',
          homePrice: home, awayPrice: away, drawPrice: null,
          spreadValue: line, totalValue: null,
          overPrice: null, underPrice: null,
        })
      }
    }
    // Total (catId 45)
    else if (!out.some(g => g.marketType === 'total')
        && (catId === 45 || /^totals?$|^total (runs|goals|points|games)$/.test(name))) {
      let over: number | null = null, under: number | null = null, line: number | null = null
      for (const r of results) {
        const p = Number(r?.americanOdds ?? r?.price?.americanOdds)
        if (!isFinite(p)) continue
        const s = sideOf(r)
        const pts = Number(r?.points ?? r?.handicap)
        if (s === 'over') { over = p; if (line == null && isFinite(pts)) line = pts }
        else if (s === 'under') { under = p; if (line == null && isFinite(pts)) line = pts }
      }
      if ((over != null || under != null) && line != null) {
        out.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null,
          spreadValue: null, totalValue: line,
          overPrice: over, underPrice: under,
        })
      }
    }
  }

  // Legacy path — keep optionMarkets parsing as a fallback for any
  // sport where Entain happens to ship game markets there instead of
  // games[]. Suspended/Closed/Hidden statuses are still filtered.
  for (const m of fixture.optionMarkets ?? []) {
    totalRaw++
    if (m.status) statusesSeen.add(m.status)
    // Old code skipped anything not status=Visible. BetMGM appears to
    // ship 'Active' / 'Open' interchangeably; broaden to "anything
    // except explicit Suspended / Closed / Hidden".
    const status = m.status ?? ''
    if (status && /^(suspended|closed|hidden|inactive|disabled)$/i.test(status)) continue
    // m.isMain === false filter dropped — Entain stopped flagging
    // game-line markets as isMain on the league-wide fixture list. We
    // don't need it: the catName match already restricts to game
    // lines and the per-market dedupe above keeps only the first.
    const catName = m.templateCategory?.name?.value ?? m.name?.value ?? ''
    if (catName) catNamesSeen.add(catName)
    const opts = m.options ?? []

    // Moneyline aliases: Entain has shipped "Match Result", "Result",
    // "Money Line" alongside "Moneyline" depending on sport.
    const isMoneyline = /^(moneyline|money\s*line|match\s*result|result|to\s*win|winner)$/i.test(catName)
    const isSpread = /^(spread|handicap|run\s*line|puck\s*line|point\s*spread|asian\s*handicap)$/i.test(catName)
    const isTotal = /^(totals?|total\s*(runs|goals|points|games))$/i.test(catName)

    if (isMoneyline && opts.length >= 2) {
      if (out.some(g => g.marketType === 'moneyline')) continue
      const byName = (label: string) =>
        opts.find(o => (o.name?.value ?? '').toLowerCase().includes(label))
      const bySrc = (src: string) =>
        opts.find(o => (o.sourceName?.value ?? '') === src)
      const home = byName(homeKey) ?? bySrc('2')
      const away = byName(awayKey) ?? bySrc('1')
      const draw = opts.find(o => (o.name?.value ?? '').toLowerCase() === 'draw')
      out.push({
        marketType: 'moneyline',
        homePrice: americanFromOption(home),
        awayPrice: americanFromOption(away),
        drawPrice: americanFromOption(draw),
        spreadValue: null, totalValue: null,
        overPrice: null, underPrice: null,
      })
    } else if (isSpread && opts.length >= 2) {
      if (out.some(g => g.marketType === 'spread')) continue
      const byName = (label: string) =>
        opts.find(o => (o.name?.value ?? '').toLowerCase().includes(label))
      const home = byName(homeKey) ?? opts[0]
      const away = home === opts[0] ? opts[1] : opts[0]
      const spread = home?.attr != null ? parseFloat(home.attr) : null
      out.push({
        marketType: 'spread',
        homePrice: americanFromOption(home),
        awayPrice: americanFromOption(away),
        drawPrice: null,
        spreadValue: spread == null || isNaN(spread) ? null : spread,
        totalValue: null, overPrice: null, underPrice: null,
      })
    } else if (isTotal && opts.length >= 2) {
      if (out.some(g => g.marketType === 'total')) continue
      const over = opts.find(o =>
        o.totalsPrefix === 'Over' || (o.name?.value ?? '').toLowerCase().startsWith('over'))
      const under = opts.find(o =>
        o.totalsPrefix === 'Under' || (o.name?.value ?? '').toLowerCase().startsWith('under'))
      const total = m.attr != null ? parseFloat(m.attr) : null
      if (total != null && !isNaN(total) && total > 0) {
        out.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: total,
          overPrice: americanFromOption(over),
          underPrice: americanFromOption(under),
        })
      }
    }
  }
  return {
    markets: out,
    debug: {
      catNames: [...catNamesSeen].slice(0, 30),
      statuses: [...statusesSeen],
      total: totalRaw,
    },
  }
}

export const betmgmAdapter: BookAdapter = {
  slug: 'betmgm_on',
  name: 'BetMGM (Ontario)',
  pollIntervalSec: 180,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      log.info('betmgm seeding session', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      } catch (e: any) {
        errors.push(`seed: ${e?.message ?? e}`)
        return { events: scraped, errors }
      }
      // Give Akamai/GeoGuard cookies time to settle.
      await page.waitForTimeout(5_000)

      const pageFetch = async (url: string): Promise<{ status: number; text: string }> => {
        return page.evaluate(async (u: string) => {
          try {
            const r = await fetch(u, {
              headers: { Accept: 'application/json, text/plain, */*' },
              credentials: 'include',
            })
            return { status: r.status, text: await r.text() }
          } catch (e: any) {
            return { status: -1, text: `fetch threw: ${e?.message ?? String(e)}` }
          }
        }, url)
      }

      for (const league of LEAGUES) {
        if (signal.aborted) break
        const listUrl =
          `https://${DOMAIN}/cds-api/bettingoffer/fixtures?${COMMON_Q}`
          + `&state=Latest&sportIds=${league.sportId}&take=200`
        const { status, text } = await pageFetch(listUrl)
        if (status !== 200) {
          log.warn('betmgm fixture list fetch non-200', {
            comp: league.name, status, sample: text.slice(0, 120),
          })
          errors.push(`${league.name} list HTTP ${status}`)
          continue
        }
        let listBody: any
        try { listBody = JSON.parse(text) } catch {
          errors.push(`${league.name} list non-JSON`)
          continue
        }
        const fixturesMeta: BMGFixture[] = (listBody.fixtures ?? []).filter(
          (f: BMGFixture) =>
            f.competition?.id === league.competitionId
            && !f.isOutright && !f.isLive,
        )
        log.info('betmgm fixtures', { comp: league.name, count: fixturesMeta.length })
        if (fixturesMeta.length === 0) continue

        // The leaderboard /bettingoffer/fixtures endpoint ships fixture
        // metadata only — markets are now empty (totalMarketsCount=226 yet
        // optionMarkets=[], games=[], marketGroups={} in the diag). To get
        // markets we have to call /bettingoffer/fixture-view per fixture
        // with offerMapping=All. Same Entain CDS pattern Sports Interaction
        // already uses successfully. Fetch in chunks of 6 (each response
        // is ~50 KB so we don't want to fan out 200 in parallel).
        const fixturesById = new Map<string | number, BMGFixture>(
          fixturesMeta.map(f => [f.id, f]),
        )
        const fixtureIds = fixturesMeta.map(f => String(f.id))
        const enriched: BMGFixture[] = []
        const VIEW_CHUNK = 6
        for (let i = 0; i < fixtureIds.length; i += VIEW_CHUNK) {
          if (signal.aborted) break
          const chunk = fixtureIds.slice(i, i + VIEW_CHUNK)
          const results = await Promise.all(chunk.map(async (id) => {
            const url =
              `https://${DOMAIN}/cds-api/bettingoffer/fixture-view?${COMMON_Q}`
              + `&fixtureIds=${id}&state=Latest&offerMapping=All`
              + `&scoreboardMode=None&useRegionalisedConfiguration=true`
              + `&includeRelatedFixtures=false&statisticsModes=None`
              + `&firstMarketGroupOnly=false`
            const { status, text } = await pageFetch(url)
            if (status !== 200) return null
            try {
              const body = JSON.parse(text)
              const list: any[] = body?.fixtures ?? (body?.fixture ? [body.fixture] : [])
              // fixture-view returns the same id with games/optionMarkets
              // populated. Merge over the leaderboard fixture so we keep
              // metadata (participants, startDate, etc.) and add markets.
              for (const fx of list) {
                const meta = fixturesById.get(fx?.id ?? Number(id))
                if (!meta) continue
                return { ...meta, ...fx } as BMGFixture
              }
              return null
            } catch { return null }
          }))
          for (const r of results) if (r) enriched.push(r)
        }
        log.info('betmgm enriched', {
          comp: league.name,
          fetched: enriched.length,
          metaCount: fixturesMeta.length,
          firstEnrichedKeys: enriched[0] ? Object.keys(enriched[0]).slice(0, 30) : null,
        })
        const fixtures: BMGFixture[] = enriched.length > 0 ? enriched : fixturesMeta

        // Aggregate diagnostics so we can see exactly what BetMGM is
        // shipping when totalGameMkts comes back 0. The first fixture
        // with no markets after parse gets its full optionMarkets array
        // logged so the next iteration can see the real shape.
        const allCatNames = new Set<string>()
        const allStatuses = new Set<string>()
        let firstNoMarketSample: any = null
        let firstFixtureKeys: string[] | null = null

        for (const fixture of fixtures) {
          if (signal.aborted) break
          if (!firstFixtureKeys) firstFixtureKeys = Object.keys(fixture)
          const parts = fixture.participants ?? []
          const home = parts.find(p => p.properties?.type === 'HomeTeam') ?? parts[1]
          const away = parts.find(p => p.properties?.type === 'AwayTeam') ?? parts[0]
          const homeName = home?.name?.value ?? ''
          const awayName = away?.name?.value ?? ''
          if (!homeName || !awayName) continue

          const { markets: gameMarkets, debug } = parseFixtureMarkets(fixture, homeName, awayName)
          for (const c of debug.catNames) allCatNames.add(c)
          for (const s of debug.statuses) allStatuses.add(s)
          if (gameMarkets.length === 0 && !firstNoMarketSample) {
            // optionMarkets and games[] both empty in the previous diag.
            // Sample marketGroups + the first fixture root keys so we can
            // see WHERE Entain has moved game markets on this CDS feed.
            const f: any = fixture
            firstNoMarketSample = JSON.stringify({
              id: fixture.id,
              optionMarketsLen: f?.optionMarkets?.length ?? 0,
              gamesLen: Array.isArray(f?.games) ? f.games.length : -1,
              gamesType: Array.isArray(f?.games) ? 'array' : typeof f?.games,
              marketGroupsLen: Array.isArray(f?.marketGroups) ? f.marketGroups.length : -1,
              marketGroupsType: Array.isArray(f?.marketGroups) ? 'array' : typeof f?.marketGroups,
              totalMarketsCount: f?.totalMarketsCount ?? null,
              firstGame: f?.games?.[0] ? JSON.stringify(f.games[0]).slice(0, 1200) : null,
              firstMarketGroup: f?.marketGroups?.[0]
                ? JSON.stringify(f.marketGroups[0]).slice(0, 1200)
                : null,
              firstParticipant: f?.participants?.[0]
                ? JSON.stringify(f.participants[0]).slice(0, 400)
                : null,
            }).slice(0, 3500)
          }
          const props = extractFixtureProps(fixture, league.leagueSlug)
          scraped.push({
            event: {
              externalId: String(fixture.id),
              homeTeam: homeName,
              awayTeam: awayName,
              startTime: fixture.startDate ?? '',
              leagueSlug: league.leagueSlug,
              sport: league.sport,
            },
            gameMarkets,
            props,
          })
        }

        log.info('betmgm parse diag', {
          comp: league.name,
          firstFixtureKeys,
          catNamesSeen: [...allCatNames],
          statusesSeen: [...allStatuses],
          fixturesWithEmptyOptionMarkets: fixtures.filter(f => (f.optionMarkets?.length ?? 0) === 0).length,
          firstNoMarketSample,
        })
      }

      log.info('betmgm scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
        totalProps: scraped.reduce((s, e) => s + e.props.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
