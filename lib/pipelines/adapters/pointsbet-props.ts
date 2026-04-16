/**
 * PointsBet Ontario adapter (lightweight — no Playwright).
 *
 * Tries pipeFetch (residential proxy) to bypass Cloudflare.
 * If PointsBet blocks proxy requests, this will silently return empty.
 *
 * API: https://api.on.pointsbet.com/api/v2
 * Events: /api/mes/v3/events/featured/competition/{key}
 * Props are embedded in specialFixedOddsMarkets on each event.
 */

import { normalizePlayerName, type NormalizedProp } from '../prop-normalizer'
import { pipeFetch } from '../proxy-fetch'

const BASE = 'https://api.on.pointsbet.com/api/v2'
const BASE_V3 = 'https://api.on.pointsbet.com/api/mes/v3'
const HEADERS: Record<string, string> = {
  'Accept': 'application/json',
  'Origin': 'https://on.pointsbet.ca',
  'Referer': 'https://on.pointsbet.ca/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
}

// Only major leagues — PointsBet competition keys
const PB_LEAGUES: { competitionKey: string; sport: string; leagueSlug: string; name: string }[] = [
  { competitionKey: 'basketball/NBA', sport: 'basketball', leagueSlug: 'nba', name: 'NBA' },
  { competitionKey: 'baseball/MLB', sport: 'baseball', leagueSlug: 'mlb', name: 'MLB' },
  { competitionKey: 'ice-hockey/NHL', sport: 'ice_hockey', leagueSlug: 'nhl', name: 'NHL' },
  { competitionKey: 'soccer/English Premier League', sport: 'soccer', leagueSlug: 'epl', name: 'EPL' },
]

export interface PBEvent {
  eventKey: string
  homeName: string
  awayName: string
  startTime: string
  leagueSlug: string
  sport: string
}

export interface PBGameMarket {
  marketType: 'moneyline' | 'spread' | 'total'
  homePrice: number | null
  awayPrice: number | null
  drawPrice: number | null
  spreadValue: number | null
  totalValue: number | null
  overPrice: number | null
  underPrice: number | null
}

export interface PBResult {
  event: PBEvent
  gameMarkets: PBGameMarket[]
  props: NormalizedProp[]
}

/** Convert decimal odds to American integer */
function decToAm(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100)
  return Math.round(-100 / (decimal - 1))
}

// PointsBet market eventClass → prop category
const PB_PROP_MAP: Record<string, string> = {
  // Basketball
  'player points': 'player_points',
  'player rebounds': 'player_rebounds',
  'player assists': 'player_assists',
  'player threes': 'player_threes',
  'player three pointers made': 'player_threes',
  'player steals': 'player_steals',
  'player blocks': 'player_blocks',
  'player turnovers': 'player_turnovers',
  'player points + rebounds + assists': 'player_pts_reb_ast',
  'player points + rebounds': 'player_pts_reb',
  'player points + assists': 'player_pts_ast',
  'player rebounds + assists': 'player_ast_reb',
  // Baseball
  'batter hits': 'player_hits',
  'batter home runs': 'player_home_runs',
  'batter rbis': 'player_rbis',
  'batter runs': 'player_runs',
  'batter total bases': 'player_total_bases',
  'batter stolen bases': 'player_stolen_bases',
  'pitcher strikeouts': 'player_strikeouts_p',
  'pitcher earned runs': 'player_earned_runs',
  'pitcher outs': 'pitcher_outs',
  // Hockey
  'player goals': 'player_goals',
  'player shots on goal': 'player_shots_on_goal',
  'player saves': 'player_saves',
  'player hockey points': 'player_hockey_points',
  'skater points': 'player_hockey_points',
  // Soccer
  'player shots on target': 'player_shots_target',
}

/** Try to map a PointsBet eventClass to a prop category */
function mapPBPropCategory(eventClass: string): string | null {
  const lower = eventClass.toLowerCase().trim()
  // Direct match
  const direct = PB_PROP_MAP[lower]
  if (direct) return direct
  // Fuzzy: check if any key is contained in the class
  for (const [key, cat] of Object.entries(PB_PROP_MAP)) {
    if (lower.includes(key)) return cat
  }
  return null
}

/** Try fetching PointsBet with proxy, then direct */
async function pbFetch(url: string): Promise<any | null> {
  try {
    // Try proxy first (residential IPs bypass Cloudflare)
    const resp = await pipeFetch(url, { headers: HEADERS })
    if (resp.ok) return resp.json()
    // If proxy fails, try direct
    const directResp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) })
    if (directResp.ok) return directResp.json()
    return null
  } catch {
    return null
  }
}

async function fetchCompetition(league: typeof PB_LEAGUES[number]): Promise<PBResult[]> {
  const data = await pbFetch(`${BASE_V3}/events/featured/competition/${league.competitionKey}?page=1`)
  if (!data) return []

  const results: PBResult[] = []

  for (const ev of data.events ?? []) {
    if (ev.isLive) continue
    if (!ev.homeTeam || !ev.awayTeam) continue

    const pbEvent: PBEvent = {
      eventKey: String(ev.key),
      homeName: ev.homeTeam,
      awayName: ev.awayTeam,
      startTime: ev.startsAt ?? '',
      leagueSlug: league.leagueSlug,
      sport: league.sport,
    }

    const gameMarkets: PBGameMarket[] = []
    const props: NormalizedProp[] = []

    for (const m of ev.specialFixedOddsMarkets ?? []) {
      const eventClass = (m.eventClass ?? '').toLowerCase()
      const outcomes = m.outcomes ?? []

      // ── Game-level markets ──
      if (eventClass.includes('moneyline') && !eventClass.includes('player')) {
        const home = outcomes.find((o: any) => (o.side ?? '').toLowerCase() === 'home')
        const away = outcomes.find((o: any) => (o.side ?? '').toLowerCase() === 'away')
        const draw = outcomes.find((o: any) => (o.name ?? '').toLowerCase() === 'draw')
        gameMarkets.push({
          marketType: 'moneyline',
          homePrice: home?.price ? decToAm(home.price) : null,
          awayPrice: away?.price ? decToAm(away.price) : null,
          drawPrice: draw?.price ? decToAm(draw.price) : null,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
        continue
      }
      if (eventClass.includes('spread') && !eventClass.includes('player')) {
        const home = outcomes.find((o: any) => (o.side ?? '').toLowerCase() === 'home')
        const away = outcomes.find((o: any) => (o.side ?? '').toLowerCase() === 'away')
        gameMarkets.push({
          marketType: 'spread',
          homePrice: home?.price ? decToAm(home.price) : null,
          awayPrice: away?.price ? decToAm(away.price) : null,
          drawPrice: null,
          spreadValue: home?.points != null ? Math.abs(home.points) : null,
          totalValue: null, overPrice: null, underPrice: null,
        })
        continue
      }
      if (eventClass.includes('total') && !eventClass.includes('player') && !eventClass.includes('batter') && !eventClass.includes('pitcher')) {
        const over = outcomes.find((o: any) => (o.name ?? '').toLowerCase().startsWith('over'))
        const under = outcomes.find((o: any) => (o.name ?? '').toLowerCase().startsWith('under'))
        gameMarkets.push({
          marketType: 'total',
          homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
          totalValue: over?.points ?? under?.points ?? null,
          overPrice: over?.price ? decToAm(over.price) : null,
          underPrice: under?.price ? decToAm(under.price) : null,
        })
        continue
      }

      // ── Player props (O/U with 2 outcomes) ──
      if (outcomes.length !== 2) continue
      const propCategory = mapPBPropCategory(m.eventClass ?? '')
      if (!propCategory) continue

      const overOut = outcomes.find((o: any) =>
        (o.name ?? '').toLowerCase().startsWith('over') || (o.side ?? '').toLowerCase() === 'over'
      )
      const underOut = outcomes.find((o: any) =>
        (o.name ?? '').toLowerCase().startsWith('under') || (o.side ?? '').toLowerCase() === 'under'
      )
      if (!overOut && !underOut) continue

      // Player name: PointsBet puts it in the market name or the outcome name
      // Market name format: "Player Name Over/Under" or just the stat
      // Try extracting from outcomes: "Over 25.5 - LeBron James" or from market.name
      let playerName = ''
      const marketName = (m.name ?? '') as string

      // Try "Player Name - Stat" from market name
      const dashMatch = marketName.match(/^(.+?)\s*-\s*/)
      if (dashMatch) {
        playerName = dashMatch[1].trim()
      } else {
        // Market name might just be the player name
        const cleaned = marketName
          .replace(/\s*(over|under)\s*\/?\s*(over|under)?\s*/gi, '')
          .replace(/\s*(points|rebounds|assists|threes|steals|blocks|goals|hits|strikeouts|saves|shots)\s*/gi, '')
          .trim()
        if (cleaned.length > 2 && cleaned.includes(' ')) {
          playerName = cleaned
        }
      }

      if (!playerName) continue

      const lineValue = overOut?.points ?? underOut?.points ?? null
      if (lineValue == null) continue

      props.push({
        propCategory,
        playerName: normalizePlayerName(playerName),
        lineValue,
        overPrice: overOut?.price ? decToAm(overOut.price) : null,
        underPrice: underOut?.price ? decToAm(underOut.price) : null,
        yesPrice: null,
        noPrice: null,
        isBinary: false,
      })
    }

    if (gameMarkets.length > 0 || props.length > 0) {
      results.push({ event: pbEvent, gameMarkets, props })
    }
  }

  return results
}

/**
 * Full PointsBet scrape: all leagues.
 * Uses residential proxy to bypass Cloudflare. Returns empty if blocked.
 */
export async function scrapePointsBet(
  signal?: AbortSignal,
): Promise<PBResult[]> {
  const results = await Promise.all(
    PB_LEAGUES.map(league => fetchCompetition(league))
  )
  const flat = results.flat()
  const propCount = flat.reduce((s, r) => s + r.props.length, 0)
  if (flat.length > 0) {
    console.log(`[PointsBet] ${flat.length} events, ${propCount} props`)
  }
  return flat
}
