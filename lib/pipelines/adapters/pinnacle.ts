// ─────────────────────────────────────────────────────────────────────────────
// Pinnacle adapter
//
// Platform:  Pinnacle guest API (public, no auth required)
// Base URL:  https://guest.api.arcadia.pinnacle.com/0.1
// Docs:      https://pinnacle.com/en/betting-articles/General/api-documentation
//
// No Playwright needed — the guest API is standard JSON over HTTPS.
// Requests go through pipeFetch (residential proxy if PROXY_URL is set).
//
// Data flow:
//   1. For each target sport, GET /sports/{sportId}/matchups
//        → list of upcoming matchups with participant names, league, start time
//   2. Filter to leagues we support (by name → toLeagueSlug)
//   3. For each kept matchup, GET /matchups/{id}/markets/straight
//        → moneyline, spread, total prices in American odds
//
// Sport IDs (Pinnacle internal):
//   3=Baseball  4=Basketball  15=Football  19=Hockey  29=Soccer
//
// Prices: American odds are provided directly in `price` field (e.g., -110, +120).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  SourceAdapter,
  FetchEventsResult,
  FetchMarketsResult,
  HealthCheckResult,
  CanonicalEvent,
  CanonicalMarket,
  CanonicalOutcome,
} from '../types'
import { normalizeEvent, americanToImplied, detectMarketShape } from '../normalize'
import { withBrowser } from '../browser-fetch'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE     = 'https://guest.api.arcadia.pinnacle.com/0.1'
// Navigate to the API subdomain itself (lightweight JSON page) so the browser
// origin is set correctly for same-origin requests — avoids loading the heavy SPA.
const SEED_URL = `${BASE}/status`

// Headers sent with every API call
const API_HEADERS = {
  'Accept':        'application/json',
  'Content-Type':  'application/json',
  'Referer':       'https://www.pinnacle.com/',
  'X-Api-Key':     'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R',
}

const SPORTS = [
  { id: 4,  name: 'Basketball' },
  { id: 19, name: 'Hockey' },
  { id: 15, name: 'Football' },
  { id: 3,  name: 'Baseball' },
  { id: 29, name: 'Soccer' },
]

// ── League slug mapping ───────────────────────────────────────────────────────

const LEAGUE_SLUG_MAP: Record<string, string> = {
  // Basketball
  'nba':                          'nba',
  'nba g league':                 'nba_gleague',
  'ncaa':                         'ncaab',
  'ncaab':                        'ncaab',
  'ncaa basketball':              'ncaab',
  'euroleague basketball':        'euroleague',
  'euroleague':                   'euroleague',
  'nbl':                          'nbl',
  // Hockey
  'nhl':                          'nhl',
  'ahl':                          'ahl',
  // Football
  'nfl':                          'nfl',
  'ncaa football':                'ncaaf',
  // Baseball
  'mlb':                          'mlb',
  // Soccer — dot format (legacy / other sources)
  'england. premier league':      'epl',
  'english premier league':       'epl',
  'usa. mls':                     'mls',
  'major league soccer':          'mls',
  'spain. la liga':               'laliga',
  'germany. bundesliga':          'bundesliga',
  'italy. serie a':               'seria_a',
  'france. ligue 1':              'ligue_one',
  'netherlands. eredivisie':      'eredivisie',
  'portugal. primeira liga':      'liga_portugal',
  'scotland. premiership':        'spl',
  'europe. champions league':     'ucl',
  'europe. europa league':        'uel',
  'europe. conference league':    'uecl',
  'england. fa cup':              'fa_cup',
  'england. championship':        'efl_champ',
  'mexico. liga mx':              'liga_mx',
  'australia. a-league':          'australia_aleague',
  'south korea. k league 1':      'k_league1',
  'japan. j1 league':             'j_league',
  // Soccer — dash format (Pinnacle uses "Country - League Name")
  'england - premier league':     'epl',
  'usa - mls':                    'mls',
  'spain - la liga':              'laliga',
  'germany - bundesliga':         'bundesliga',
  'italy - serie a':              'seria_a',
  'france - ligue 1':             'ligue_one',
  'netherlands - eredivisie':     'eredivisie',
  'portugal - primeira liga':     'liga_portugal',
  'scotland - premiership':       'spl',
  'europe - champions league':    'ucl',
  'europe - europa league':       'uel',
  'europe - conference league':   'uecl',
  'england - fa cup':             'fa_cup',
  'england - championship':       'efl_champ',
  'mexico - liga mx':             'liga_mx',
  'australia - a-league':         'australia_aleague',
  'south korea - k league 1':     'k_league1',
  'japan - j1 league':            'j_league',
}

function toLeagueSlug(leagueName: string): string | null {
  const n = (leagueName ?? '').toLowerCase().trim()
  // Exact match first
  if (LEAGUE_SLUG_MAP[n]) return LEAGUE_SLUG_MAP[n]
  // Partial match — Pinnacle often prefixes with country (e.g., "USA. NBA")
  for (const [key, slug] of Object.entries(LEAGUE_SLUG_MAP)) {
    if (n.includes(key) || n.endsWith('. ' + key)) return slug
  }
  return null
}

// ── API helpers ───────────────────────────────────────────────────────────────

// fetchJson is provided by the BrowserSession — runs fetch inside Chromium
// so Cloudflare sees a real browser TLS fingerprint.
type FetchJsonFn = (url: string, headers?: Record<string, string>) => Promise<any>

async function apiGet(fetchJson: FetchJsonFn, path: string): Promise<any> {
  return fetchJson(`${BASE}${path}`, API_HEADERS)
}

// ── Types mirroring Pinnacle guest API response shapes ────────────────────────

interface PinnMatchup {
  id: number
  isLive: boolean    // true = in-play; false = upcoming (no 'type' field in this API)
  hasMarkets: boolean
  league: { id: number; name: string; group: string }
  startTime: string  // ISO 8601
  participants: Array<{ alignment: 'home' | 'away'; name: string }>
  parentId?: number | null
}

interface PinnPrice {
  designation: 'home' | 'away' | 'draw' | 'over' | 'under'
  price: number      // American odds
  points?: number    // spread/total line
}

interface PinnMarket {
  type: 'moneyline' | 'spread' | 'total'
  matchupId: number
  key: string        // "{line}@{matchupId}"
  prices: PinnPrice[]
}

// ── Market extraction ─────────────────────────────────────────────────────────

function buildOutcome(
  label: string,
  price: number,
  side: CanonicalOutcome['side']
): CanonicalOutcome {
  return { side, label, price, impliedProb: americanToImplied(price) }
}

function extractMarkets(
  raw: PinnMarket[],
  matchupId: number,
  leagueSlug: string
): CanonicalMarket[] {
  const out: CanonicalMarket[] = []
  const now = new Date().toISOString()

  for (const m of raw) {
    if (m.matchupId !== matchupId) continue
    const prices = m.prices ?? []

    if (m.type === 'moneyline') {
      const outcomes: CanonicalOutcome[] = []
      for (const p of prices) {
        if (p.designation === 'home') outcomes.push(buildOutcome('Home', p.price, 'home'))
        else if (p.designation === 'away') outcomes.push(buildOutcome('Away', p.price, 'away'))
        else if (p.designation === 'draw') outcomes.push(buildOutcome('Draw', p.price, 'draw'))
      }
      if (outcomes.length >= 2) {
        out.push({ eventId: String(matchupId), marketType: 'moneyline', shape: detectMarketShape(leagueSlug, 'moneyline'), outcomes, lineValue: null, sourceSlug: 'pinnacle', capturedAt: now })
      }

    } else if (m.type === 'spread') {
      const home = prices.find(p => p.designation === 'home')
      const away = prices.find(p => p.designation === 'away')
      if (!home || !away || home.points == null) continue
      const lineValue = Math.abs(home.points)
      const outcomes: CanonicalOutcome[] = [
        buildOutcome(`Home ${home.points > 0 ? '+' : ''}${home.points}`, home.price, 'home'),
        buildOutcome(`Away ${away.points != null && away.points > 0 ? '+' : ''}${away.points ?? ''}`, away.price, 'away'),
      ]
      out.push({ eventId: String(matchupId), marketType: 'spread', shape: '2way', outcomes, lineValue, sourceSlug: 'pinnacle', capturedAt: now })

    } else if (m.type === 'total') {
      const over  = prices.find(p => p.designation === 'over')
      const under = prices.find(p => p.designation === 'under')
      if (!over || !under || over.points == null) continue
      const lineValue = over.points
      const outcomes: CanonicalOutcome[] = [
        buildOutcome(`Over ${lineValue}`,  over.price,  'over'),
        buildOutcome(`Under ${lineValue}`, under.price, 'under'),
      ]
      out.push({ eventId: String(matchupId), marketType: 'total', shape: '2way', outcomes, lineValue, sourceSlug: 'pinnacle', capturedAt: now })
    }
  }

  return out
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export const pinnacleAdapter: SourceAdapter = {
  slug: 'pinnacle',
  ingestionMethod: 'direct-api (guest.api.arcadia)',

  async fetchEvents(): Promise<FetchEventsResult> {
    const start = Date.now()

    return withBrowser(async ({ visit, fetchJson }) => {
      // Visit seed URL so Chromium gets CF cookies for pinnacle.com and its API subdomain
      await visit(SEED_URL)

      const allEvents: CanonicalEvent[] = []
      const allMarkets: CanonicalMarket[] = []
      const rawPayloads: unknown[] = []
      const errors: string[] = []

      // Step 1: fetch matchups for each sport in parallel
      const sportMatchups = await Promise.allSettled(
        SPORTS.map(async (sport) => {
          const data: PinnMatchup[] = await apiGet(fetchJson, `/sports/${sport.id}/matchups?withSpecials=false&handicapStyle=american`)
          return { sport, matchups: data }
        })
      )

      // Step 2: filter to pregame matchups in target leagues
      interface KeptMatchup { matchup: PinnMatchup; leagueSlug: string }
      const kept: KeptMatchup[] = []

      for (const res of sportMatchups) {
        if (res.status === 'rejected') {
          errors.push(`matchups fetch: ${res.reason?.message ?? res.reason}`)
          continue
        }
        const { sport, matchups } = res.value
        // Debug: dump raw response shape and first item
        if (matchups.length > 0) console.log(`[pinnacle] ${sport.name} first matchup:`, JSON.stringify(matchups[0]).slice(0, 800))
        // Upcoming = not live + has markets + no parentId (parent = alt-line child)
        const pregame = matchups.filter((m: PinnMatchup) => !m.isLive && m.hasMarkets && !m.parentId)
        const slugCounts: Record<string, number> = {}
        for (const m of pregame) {
          const slug = toLeagueSlug(m.league?.name ?? '')
          if (!slug) continue
          kept.push({ matchup: m, leagueSlug: slug })
          slugCounts[slug] = (slugCounts[slug] ?? 0) + 1
        }
        console.log(`[pinnacle] ${sport.name}: ${pregame.length} pregame → ${Object.values(slugCounts).reduce((a, b) => a + b, 0)} target-league. leagues: ${JSON.stringify(slugCounts)}`)
      }

      rawPayloads.push({ matchupCount: kept.length })

      if (kept.length === 0) {
        console.log('[pinnacle] no target-league matchups found')
        return { raw: rawPayloads, events: [], markets: [], errors } as any
      }

      // Step 3: build events
      for (const { matchup, leagueSlug } of kept) {
        const home = matchup.participants.find(p => p.alignment === 'home')?.name ?? ''
        const away = matchup.participants.find(p => p.alignment === 'away')?.name ?? ''
        if (!home || !away) continue
        allEvents.push(normalizeEvent({
          externalId: String(matchup.id),
          homeTeam:   home,
          awayTeam:   away,
          startTime:  matchup.startTime,
          leagueSlug,
          sourceSlug: 'pinnacle',
        }))
      }

      // Step 4: fetch markets — 10 concurrent
      const CONCURRENCY = 10
      for (let i = 0; i < kept.length; i += CONCURRENCY) {
        const chunk = kept.slice(i, i + CONCURRENCY)
        await Promise.allSettled(
          chunk.map(async ({ matchup, leagueSlug }) => {
            try {
              const raw: PinnMarket[] = await apiGet(fetchJson, `/matchups/${matchup.id}/markets/straight?primaryOnly=true`)
              rawPayloads.push(raw)
              allMarkets.push(...extractMarkets(raw, matchup.id, leagueSlug))
            } catch (e: any) {
              errors.push(`markets ${matchup.id}: ${e.message}`)
            }
          })
        )
      }

      console.log(`[pinnacle] fetchEvents: ${allEvents.length} events, ${allMarkets.length} markets, ${errors.length} errors in ${Date.now() - start}ms`)
      if (errors.length) console.error('[pinnacle] errors:', errors)

      return { raw: rawPayloads, events: allEvents, markets: allMarkets, errors } as any
    })
  },

  async fetchMarkets(eventId: string): Promise<FetchMarketsResult> {
    return withBrowser(async ({ visit, fetchJson }) => {
      await visit(SEED_URL)
      const raw: PinnMarket[] = await apiGet(fetchJson, `/matchups/${eventId}/markets/straight?primaryOnly=false`)
      const markets = extractMarkets(raw, Number(eventId), '')
      return { raw, markets }
    })
  },

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now()
    try {
      await withBrowser(async ({ visit, fetchJson }) => {
        await visit(SEED_URL)
        const data = await apiGet(fetchJson, '/sports/4/matchups?withSpecials=false&handicapStyle=american')
        if (!Array.isArray(data)) throw new Error('Unexpected response shape')
        console.log(`[pinnacle] health: ${data.length} basketball matchups`)
      })
      const latencyMs = Date.now() - start
      return { healthy: true, latencyMs, message: `ok (${latencyMs}ms)` }
    } catch (e: any) {
      return { healthy: false, latencyMs: Date.now() - start, message: e.message }
    }
  },
}
