/**
 * Pinnacle adapter (Playwright edition).
 *
 * Uses the guest Arcadia API (same endpoint pattern the main site calls).
 * The Vercel pipeFetch version works for game lines but returns 0 props
 * because Pinnacle serves props from a different matchup graph that requires
 * the web app's session cookies. Running in a Chromium context issues those
 * cookies and unlocks the prop feed.
 *
 * API pattern:
 *   GET /0.1/leagues/{leagueId}/matchups           → games + specials (props)
 *   GET /0.1/matchups/{matchupId}/markets/related/straight → pricing
 */

import { withPage } from '../lib/browser.js'
import { americanToImpliedProb } from '../lib/canonical.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, NormalizedEvent, GameMarket, NormalizedProp } from '../lib/types.js'

const BASE = 'https://guest.api.arcadia.pinnacle.com/0.1'
const API_KEY = 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R'
const SEED = 'https://www.pinnacle.com/en/'

const HEADERS: Record<string, string> = {
  'x-api-key': API_KEY,
  'x-device-uuid': 'c5dfc3d5-e09c9b54-ef3f7e7e-4abf6d23',
  'content-type': 'application/json',
  'referer': 'https://www.pinnacle.com/',
  'origin': 'https://www.pinnacle.com',
}

const LEAGUES: { id: number; slug: string; sport: string; name: string }[] = [
  { id: 487,   slug: 'nba',         sport: 'basketball', name: 'NBA' },
  { id: 246,   slug: 'mlb',         sport: 'baseball',   name: 'MLB' },
  { id: 1456,  slug: 'nhl',         sport: 'ice_hockey', name: 'NHL' },
  { id: 1980,  slug: 'epl',         sport: 'soccer',     name: 'EPL' },
  { id: 2036,  slug: 'laliga',      sport: 'soccer',     name: 'La Liga' },
  { id: 1842,  slug: 'bundesliga',  sport: 'soccer',     name: 'Bundesliga' },
  { id: 2093,  slug: 'seria_a',     sport: 'soccer',     name: 'Serie A' },
  { id: 2030,  slug: 'ligue_one',   sport: 'soccer',     name: 'Ligue 1' },
]

// Pinnacle "Player Props" → canonical prop categories
const PROP_MAP: Record<string, string> = {
  'points':                'player_points',
  'rebounds':              'player_rebounds',
  'assists':               'player_assists',
  'threes':                'player_threes',
  '3-point fg':            'player_threes',
  'pts+rebs+asts':         'player_pts_reb_ast',
  'pts + rebs + asts':     'player_pts_reb_ast',
  'steals':                'player_steals',
  'blocks':                'player_blocks',
  'turnovers':             'player_turnovers',
  'hits':                  'player_hits',
  'home runs':             'player_home_runs',
  'rbis':                  'player_rbis',
  'total bases':           'player_total_bases',
  'runs':                  'player_runs',
  'stolen bases':          'player_stolen_bases',
  'walks':                 'player_walks',
  'strikeouts':            'player_strikeouts_p',
  'earned runs':           'player_earned_runs',
  'hits allowed':          'player_hits_allowed',
  'outs':                  'pitcher_outs',
  'goals':                 'player_goals',
  'shots on goal':         'player_shots_on_goal',
  'saves':                 'player_saves',
  'power play points':     'player_power_play_pts',
  'shots on target':       'player_shots_target',
}

/**
 * Pinnacle's guest Arcadia API returns DECIMAL odds (e.g. 1.91, 2.05).
 * Our prop_odds / game_market tables store American odds as integers.
 * Values between 1.0 and 20 are treated as decimal; everything else is already
 * American (Pinnacle never returns American > 20 or < -10000 for realistic markets,
 * but |value| is a reliable discriminator: decimal is always in [1.01, ~30],
 * American is always |v| >= 100).
 */
function normalizePinnaclePrice(v: number | null | undefined): number | null {
  if (v == null) return null
  if (v > 1 && v < 50) {
    // Decimal odds → American
    if (v >= 2) return Math.round((v - 1) * 100)
    return Math.round(-100 / (v - 1))
  }
  return Math.round(v)
}

interface PinnacleMatchup {
  id: number
  type: 'matchup' | 'special'
  startTime?: string
  isLive?: boolean
  hasMarkets?: boolean
  participants?: Array<{ name: string; alignment?: string }>
  special?: { category?: string; description?: string }
  parent?: { id: number; startTime?: string }
}

interface PinnacleMarket {
  matchupId: number
  type: string         // 'moneyline' | 'spread' | 'total'
  key: string
  prices?: Array<{
    designation?: string // 'home' | 'away' | 'over' | 'under'
    participantId?: number
    price: number        // American odds
    points?: number      // line value for spread/total
  }>
}

/** Parse "Player Name (Stat)" from a special's description. */
function parseSpecialDesc(desc: string): { playerName: string; stat: string } | null {
  const m = desc.match(/^(.+?)\s*\((.+)\)\s*$/)
  if (!m) return null
  return { playerName: m[1].trim(), stat: m[2].trim().toLowerCase() }
}

async function gql(page: import('playwright').Page, url: string): Promise<any> {
  // Use Playwright's built-in request context (bypasses browser CORS) but
  // carry the cookies + UA from the page context for auth/challenge parity.
  const resp = await page.request.get(url, { headers: HEADERS })
  if (!resp.ok()) {
    const body = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status()}: ${body.slice(0, 200)}`)
  }
  return resp.json()
}

export const pinnacleAdapter: BookAdapter = {
  slug: 'pinnacle',
  name: 'Pinnacle',
  pollIntervalSec: 180,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []
      let rawPriceSampled = false

      await page.goto(SEED, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.waitForTimeout(1_500)

      for (const league of LEAGUES) {
        if (signal.aborted) break
        let matchups: PinnacleMatchup[]
        try {
          matchups = await gql(page, `${BASE}/leagues/${league.id}/matchups`)
          if (!Array.isArray(matchups)) matchups = []
        } catch (e: any) {
          errors.push(`matchups ${league.name}: ${e.message}`)
          continue
        }

        const games = matchups.filter(m => m.type === 'matchup' && !m.isLive)
        const specials = matchups.filter(m =>
          m.type === 'special' &&
          m.special?.category === 'Player Props' &&
          m.hasMarkets &&
          !m.isLive
        )

        // Build game map for event lookup. Skip Pinnacle's daily-parlay
        // placeholder matchups ("Home Goals (3 Games)" / "Away Teams
        // (4 Games)" etc.) — they show up as real matchups in this API
        // but aren't a head-to-head game.
        const isPlaceholderTeam = (name: string): boolean => {
          if (!name) return true
          if (/\(\d+\s*Games?\)/i.test(name)) return true
          if (/^(home|away)\s+(teams?|goals?|runs?|points?)(\s|$)/i.test(name)) return true
          return false
        }
        const gameMap = new Map<number, { event: NormalizedEvent; gameMarkets: GameMarket[]; props: NormalizedProp[] }>()
        for (const g of games) {
          const home = g.participants?.find(p => p.alignment === 'home')?.name ?? ''
          const away = g.participants?.find(p => p.alignment === 'away')?.name ?? ''
          if (!home || !away) continue
          if (isPlaceholderTeam(home) || isPlaceholderTeam(away)) continue
          gameMap.set(g.id, {
            event: {
              externalId: String(g.id),
              homeTeam: home,
              awayTeam: away,
              startTime: g.startTime ?? '',
              leagueSlug: league.slug,
              sport: league.sport,
            },
            gameMarkets: [],
            props: [],
          })
        }

        // Fetch markets for all games in parallel (bounded)
        const gameIds = [...gameMap.keys()]
        const GAME_BATCH = 8
        for (let i = 0; i < gameIds.length; i += GAME_BATCH) {
          if (signal.aborted) break
          const chunk = gameIds.slice(i, i + GAME_BATCH)
          await Promise.all(chunk.map(async (id) => {
            try {
              const markets: PinnacleMarket[] = await gql(page, `${BASE}/matchups/${id}/markets/related/straight`)
              const bucket = gameMap.get(id)!

              // Pinnacle bundles many alt spreads / alt totals in the same
              // response. The writer dedups game markets to one row per
              // (event, source, market_type), so we MUST pick the main line
              // here — otherwise a random alt (e.g. Astros -7 @ -560) wins
              // the dedup and poisons cross-book comparisons. Use balance
              // (prices closest to 50/50) as the main-line heuristic —
              // Pinnacle's main lines are always near -110/-110.
              type Pin = { home?: number; away?: number; over?: number; under?: number; handicap?: number }
              const mlCandidates: Pin[] = []
              let bestSpread: Pin | null = null
              let bestSpreadBalance = Infinity
              let bestTotal: Pin | null = null
              let bestTotalBalance = Infinity

              for (const m of markets) {
                if (m.key && !m.key.includes('s;0;')) continue
                const home = m.prices?.find(p => p.designation === 'home')
                const away = m.prices?.find(p => p.designation === 'away')
                const over = m.prices?.find(p => p.designation === 'over')
                const under = m.prices?.find(p => p.designation === 'under')

                if (m.type === 'moneyline') {
                  mlCandidates.push({
                    home: normalizePinnaclePrice(home?.price) ?? undefined,
                    away: normalizePinnaclePrice(away?.price) ?? undefined,
                  })
                } else if (m.type === 'spread') {
                  const h = normalizePinnaclePrice(home?.price)
                  const a = normalizePinnaclePrice(away?.price)
                  if (h == null || a == null) continue
                  const hProb = americanToImpliedProb(h)
                  const aProb = americanToImpliedProb(a)
                  const balance = Math.abs(hProb - aProb)
                  if (balance < bestSpreadBalance) {
                    bestSpreadBalance = balance
                    bestSpread = {
                      home: h, away: a,
                      // Signed handicap from home team's perspective.
                      handicap: home?.points != null
                        ? home.points
                        : (away?.points != null ? -away.points : undefined),
                    }
                  }
                } else if (m.type === 'total') {
                  const o = normalizePinnaclePrice(over?.price)
                  const u = normalizePinnaclePrice(under?.price)
                  if (o == null || u == null) continue
                  const oProb = americanToImpliedProb(o)
                  const uProb = americanToImpliedProb(u)
                  const balance = Math.abs(oProb - uProb)
                  if (balance < bestTotalBalance) {
                    bestTotalBalance = balance
                    bestTotal = {
                      over: o, under: u,
                      handicap: over?.points ?? under?.points ?? undefined,
                    }
                  }
                }
              }

              if (mlCandidates.length > 0) {
                const ml = mlCandidates[0]
                bucket.gameMarkets.push({
                  marketType: 'moneyline',
                  homePrice: ml.home ?? null,
                  awayPrice: ml.away ?? null,
                  drawPrice: null,
                  spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
                })
              }
              if (bestSpread) {
                bucket.gameMarkets.push({
                  marketType: 'spread',
                  homePrice: bestSpread.home ?? null,
                  awayPrice: bestSpread.away ?? null,
                  drawPrice: null,
                  spreadValue: bestSpread.handicap ?? null,
                  totalValue: null, overPrice: null, underPrice: null,
                })
              }
              if (bestTotal) {
                bucket.gameMarkets.push({
                  marketType: 'total',
                  homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
                  totalValue: bestTotal.handicap ?? null,
                  overPrice: bestTotal.over ?? null,
                  underPrice: bestTotal.under ?? null,
                })
              }
            } catch (e: any) {
              errors.push(`game markets ${id}: ${e.message}`)
            }
          }))
        }

        // Fetch special markets (props) in parallel
        const SPEC_BATCH = 10
        for (let i = 0; i < specials.length; i += SPEC_BATCH) {
          if (signal.aborted) break
          const chunk = specials.slice(i, i + SPEC_BATCH)
          await Promise.all(chunk.map(async (s) => {
            const parentId = s.parent?.id
            if (!parentId) return
            const bucket = gameMap.get(parentId)
            if (!bucket) return

            const parsed = parseSpecialDesc(s.special?.description ?? '')
            if (!parsed) return
            const category = PROP_MAP[parsed.stat]
            if (!category) return

            try {
              const markets: PinnacleMarket[] = await gql(page, `${BASE}/matchups/${s.id}/markets/related/straight`)
              // Pair over/under strictly by line value across ALL total markets
              // for this special. A single Pinnacle "total" market sometimes
              // contains prices for multiple alt lines; .find() picking the
              // first over and first under caused mismatched-line pairs and
              // nonsensical fair probs on the main app.
              const byLine = new Map<number, { over?: number; under?: number }>()
              for (const m of markets) {
                if (m.type !== 'total') continue
                // Only full-game markets. Pinnacle keys like 's;0;ou;X.Y;' are
                // full-game totals; period variants use 's;1;', 's;2;', etc.
                // Without this filter we were mixing per-period prices with
                // full-game lines and producing nonsense fair probs.
                if (m.key && !m.key.includes('s;0;')) continue
                for (const p of m.prices ?? []) {
                  if (p.points == null || p.price == null) continue
                  const american = normalizePinnaclePrice(p.price)
                  if (american == null) continue
                  const entry = byLine.get(p.points) ?? {}
                  if (p.designation === 'over') entry.over = american
                  else if (p.designation === 'under') entry.under = american
                  byLine.set(p.points, entry)
                }
              }

              if (!rawPriceSampled && byLine.size > 0) {
                rawPriceSampled = true
                log.info('raw prop price sample', {
                  league: league.slug,
                  player: parsed.playerName,
                  stat: parsed.stat,
                  marketCount: markets.length,
                  lineCount: byLine.size,
                  lines: [...byLine.entries()].slice(0, 5).map(([line, p]) => ({
                    line, over: p.over, under: p.under,
                  })),
                })
              }

              for (const [line, prices] of byLine) {
                // Require BOTH sides for a prop row; one-sided Pinnacle entries
                // corrupt the +EV fair-prob calc (they can't be devigged).
                if (prices.over == null || prices.under == null) continue
                bucket.props.push({
                  propCategory: category,
                  playerName: parsed.playerName,
                  lineValue: line,
                  overPrice: prices.over,
                  underPrice: prices.under,
                  yesPrice: null, noPrice: null, isBinary: false,
                })
              }
            } catch (e: any) {
              errors.push(`prop markets ${s.id}: ${e.message}`)
            }
          }))
        }

        // Flush buckets with data
        for (const bucket of gameMap.values()) {
          if (bucket.gameMarkets.length > 0 || bucket.props.length > 0) {
            scraped.push(bucket)
          }
        }

        log.debug(`${league.name}: ${games.length} games, ${specials.length} specials`)
      }

      return { events: scraped, errors }
    })
  },
}
