/**
 * TonyBet (Ontario) — real adapter.
 *
 * Endpoint (confirmed via discovery):
 *   GET https://platform.tonybet.com/api/event/list
 *        ?lang=en
 *        &relations[]=odds
 *        &relations[]=competitors
 *        &relations[]=league
 *        &relations[]=sportCategories
 *   Response: { status: "ok", data: { items: [ {...event} ] } }
 *
 * Strategy: navigate the CA sportsbook to each major sport, passively
 * capture /api/event/list responses the SPA fires with full bodies (we bump
 * the capture window far above the normal discovery snippet size), then
 * parse the items[] array with permissive shape extraction. On the first
 * run per deploy we log one full item so we can iterate on the schema.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, NormalizedEvent } from '../lib/types.js'

const SEED_URL = 'https://tonybet.com/en-ca/sport'

const SPORT_PATHS: Array<{ path: string; leagueSlug: string; sport: string; leagueNameRe: RegExp }> = [
  { path: 'basketball', leagueSlug: 'nba', sport: 'basketball', leagueNameRe: /\bnba\b/i },
  { path: 'baseball',   leagueSlug: 'mlb', sport: 'baseball',   leagueNameRe: /\bmlb\b/i },
  { path: 'ice-hockey', leagueSlug: 'nhl', sport: 'ice_hockey', leagueNameRe: /\bnhl\b/i },
]

// TonyBet /api/event/list ships `sportId` + `sportCategoryId` + `leagueId`
// as opaque numbers and doesn't inline league names. Map sportId -> sport,
// then detect NBA/MLB/NHL by matching slug teams against the known rosters.
const SPORT_ID_MAP: Record<number, string> = {
  2: 'basketball',
  3: 'baseball',
  4: 'ice_hockey',
}

// Canonical city/name tokens that identify each top North American league.
// We match on the slug (lowercase, hyphen-joined) — any hit flags the event.
const NBA_TOKENS = new Set([
  'lakers','clippers','warriors','kings','suns','nuggets','jazz','trail-blazers','blazers','timberwolves',
  'thunder','rockets','mavericks','spurs','pelicans','grizzlies',
  'celtics','knicks','nets','76ers','sixers','raptors','bucks','pacers','bulls','pistons','cavaliers','hawks','hornets','heat','magic','wizards',
])
const MLB_TOKENS = new Set([
  'dodgers','giants','padres','rockies','diamondbacks','angels','astros','rangers','athletics','mariners',
  'twins','royals','white-sox','whitesox','indians','guardians','tigers','blue-jays','bluejays','yankees','red-sox','redsox','orioles','rays',
  'brewers','cubs','cardinals','pirates','reds','braves','marlins','mets','phillies','nationals',
])
const NHL_TOKENS = new Set([
  'golden-knights','vegas-golden-knights','utah-hockey-club','kings','ducks','sharks','flames','oilers','canucks','jets','wild','avalanche','stars',
  'blackhawks','blues','predators','red-wings','redwings','blue-jackets','bluejackets','penguins','flyers','rangers','islanders','devils','capitals','hurricanes',
  'panthers','lightning','senators','maple-leafs','mapleleafs','canadiens','bruins','sabres','kraken',
])

function leagueFromSlug(slug: string, sportId: number | undefined): { leagueSlug: string; sport: string } | null {
  if (!slug) return null
  const s = slug.toLowerCase()
  const hitAny = (set: Set<string>) => [...set].some(tok => s.includes(tok))
  if (hitAny(NBA_TOKENS)) return { leagueSlug: 'nba', sport: 'basketball' }
  if (hitAny(NHL_TOKENS)) return { leagueSlug: 'nhl', sport: 'ice_hockey' }
  if (hitAny(MLB_TOKENS)) return { leagueSlug: 'mlb', sport: 'baseball' }
  // Fall back to sport-only classification if sportId known.
  if (sportId != null && SPORT_ID_MAP[sportId]) {
    return { leagueSlug: '', sport: SPORT_ID_MAP[sportId] }
  }
  return null
}

/** Try the common American / decimal / fractional shapes the BetConstruct
 *  stack uses. Returns null if nothing parses. */
function toAmerican(price: any): number | null {
  if (price == null) return null
  if (typeof price === 'number') {
    // BetConstruct stores decimal odds as numbers like 1.91.
    if (price >= 1.01 && price <= 50) {
      if (price >= 2) return Math.round((price - 1) * 100)
      return Math.round(-100 / (price - 1))
    }
    // Sometimes already american.
    if (price >= 100 || price <= -100) return Math.round(price)
    return null
  }
  if (typeof price === 'string') {
    const n = Number(price)
    if (!isNaN(n)) return toAmerican(n)
  }
  if (typeof price === 'object') {
    if (price.american != null) return toAmerican(price.american)
    if (price.odds != null) return toAmerican(price.odds)
    if (price.price != null) return toAmerican(price.price)
    if (price.value != null) return toAmerican(price.value)
    if (price.coefficient != null) return toAmerican(price.coefficient)
  }
  return null
}

/** Classify a market/odd group name to our canonical market type. */
function classifyMarket(name: string): 'moneyline' | 'spread' | 'total' | null {
  const n = name.toLowerCase()
  // Guard against period/half/quarter/prop markets.
  if (/\b(1st|2nd|3rd|4th|first|second|third|fourth|half|quarter|inning|period|race to|to score|alt)\b/.test(n)) return null
  if (/money\s*line|moneyline|match\s*winner|1x2|to\s*win/.test(n)) return 'moneyline'
  if (/run\s*line|puck\s*line|point\s*spread|\bspread\b|handicap/.test(n)) return 'spread'
  if (/\btotal\b|over\/?under|over\s*\/\s*under|totals/.test(n)) return 'total'
  return null
}

interface TonyBetEvent {
  id: number | string
  team1?: { name?: string } | string
  team2?: { name?: string } | string
  homeTeam?: string
  awayTeam?: string
  competitors?: Array<{ name?: string; home?: boolean; isHome?: boolean; role?: string; side?: string }>
  startTs?: number | string
  startDate?: string
  startTime?: string
  time?: string                 // "2026-04-22 01:30:00" (space-delimited, UTC)
  translationSlug?: string      // "home-team-away-team" (hyphen-joined)
  sportId?: number
  sportCategoryId?: number
  leagueId?: number | string
  league?: { name?: string } | string
  leagueName?: string
  odds?: any[]
  markets?: any[]
}

/** Split a "home-team-away-team" slug. Since we don't know where the boundary
 *  is, we try all split points and pick one whose halves plausibly look like
 *  team names (both start with a capital letter when Title-Cased and each
 *  have >= 1 word). The tournament league set is small enough that we can
 *  also crib known multi-word team tokens to steer the split. Returns
 *  Title-Cased team names. */
function teamsFromSlug(slug: string): { home: string; away: string } | null {
  if (!slug || !slug.includes('-')) return null
  const parts = slug.split('-').filter(Boolean)
  if (parts.length < 2) return null
  // Known multi-word city/name roots. When we see these, we snap to them.
  const KNOWN_MULTI = [
    'new-york', 'new-jersey', 'new-orleans', 'los-angeles', 'san-francisco',
    'san-antonio', 'san-diego', 'san-jose', 'oklahoma-city', 'golden-state',
    'portland-trail', 'portland-trail-blazers', 'trail-blazers',
    'utah-hockey-club', 'vegas-golden-knights', 'colorado-avalanche',
    'tampa-bay', 'st-louis',
  ]
  const joined = parts.join('-')
  // Walk possible split points; prefer the longest valid known-prefix match.
  const tryPair = (left: string[], right: string[]): { home: string; away: string } | null => {
    if (left.length === 0 || right.length === 0) return null
    const home = left.map(titleCase).join(' ')
    const away = right.map(titleCase).join(' ')
    return { home, away }
  }
  // Prefer a known-multi home team.
  for (const km of KNOWN_MULTI) {
    if (joined.startsWith(km + '-')) {
      const leftTokens = km.split('-')
      return tryPair(leftTokens, parts.slice(leftTokens.length))
    }
    const suffixIdx = joined.indexOf('-' + km + '-')
    if (suffixIdx > 0 && joined.endsWith('-' + km) === false) {
      // km in middle? unusual — skip
    }
    if (joined.endsWith('-' + km)) {
      const rightTokens = km.split('-')
      const leftTokens = parts.slice(0, parts.length - rightTokens.length)
      return tryPair(leftTokens, rightTokens)
    }
  }
  // Fallback: midpoint split — imperfect but we pass the raw name to the
  // canonical normalizer which handles most casing/alias edge cases.
  const mid = Math.floor(parts.length / 2)
  return tryPair(parts.slice(0, mid), parts.slice(mid))
}

function titleCase(word: string): string {
  return word.length === 0 ? '' : word[0].toUpperCase() + word.slice(1).toLowerCase()
}

/** Pull team names from the various shapes BetConstruct sites use. */
function extractTeams(e: TonyBetEvent): { home: string; away: string } | null {
  const get = (x: any): string => {
    if (!x) return ''
    if (typeof x === 'string') return x
    if (typeof x === 'object') return String(x.name ?? x.teamName ?? x.shortName ?? '')
    return ''
  }
  // team1 / team2
  const t1 = get((e as any).team1), t2 = get((e as any).team2)
  if (t1 && t2) return { home: t1, away: t2 }
  // explicit home/away
  if (e.homeTeam && e.awayTeam) return { home: e.homeTeam, away: e.awayTeam }
  // competitors[]
  if (Array.isArray(e.competitors) && e.competitors.length >= 2) {
    const homeC = e.competitors.find(c => c.home === true || c.isHome === true || c.role === 'home' || c.side === 'home')
    const awayC = e.competitors.find(c => c !== homeC)
    const home = get(homeC ?? e.competitors[0])
    const away = get(awayC ?? e.competitors[1])
    if (home && away) return { home, away }
  }
  // translationSlug: "vegas-golden-knights-utah-hockey-club"
  if (typeof e.translationSlug === 'string') {
    const pair = teamsFromSlug(e.translationSlug)
    if (pair) return pair
  }
  return null
}

function extractStartIso(e: TonyBetEvent): string | null {
  if (typeof e.startDate === 'string' && e.startDate.length >= 10) return e.startDate
  if (typeof e.startTime === 'string' && e.startTime.length >= 10) return e.startTime
  // TonyBet ships UTC as "YYYY-MM-DD HH:MM:SS" in field `time`.
  if (typeof e.time === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(e.time)) {
    const iso = e.time.replace(' ', 'T') + (e.time.length === 19 ? '.000Z' : 'Z')
    if (!isNaN(Date.parse(iso))) return iso
  }
  if (typeof e.startTs === 'number') return new Date(e.startTs * 1000).toISOString()
  if (typeof e.startTs === 'string') {
    const n = Number(e.startTs)
    if (!isNaN(n)) return new Date(n * 1000).toISOString()
  }
  const ts = (e as any).startTimestamp
  if (typeof ts === 'number') return new Date(ts * 1000).toISOString()
  return null
}

function extractLeagueName(e: TonyBetEvent): string {
  if (typeof e.league === 'string') return e.league
  if (e.league && typeof e.league === 'object') return String(e.league.name ?? '')
  return String(e.leagueName ?? '')
}

/** Walk an event's odds/markets collection and emit game markets we recognize. */
function extractGameMarkets(e: TonyBetEvent, home: string, away: string): GameMarket[] {
  const groups = (Array.isArray(e.odds) ? e.odds : []).concat(Array.isArray(e.markets) ? e.markets : [])
  if (groups.length === 0) return []

  // Each "group" is a market: has name + outcomes[] (or odds[]).
  const byType: Record<'moneyline' | 'spread' | 'total', any[]> = { moneyline: [], spread: [], total: [] }
  for (const g of groups) {
    const name = String(g?.name ?? g?.marketName ?? g?.title ?? g?.m ?? '')
    const t = classifyMarket(name)
    if (!t) continue
    byType[t].push(g)
  }

  const out: GameMarket[] = []
  const outcomesOf = (g: any): any[] =>
    Array.isArray(g?.outcomes) ? g.outcomes
    : Array.isArray(g?.odds) ? g.odds
    : Array.isArray(g?.selections) ? g.selections
    : []

  const lineOf = (o: any): number | null => {
    for (const k of ['base', 'line', 'handicap', 'point', 'value', 'param']) {
      const v = o?.[k]
      if (typeof v === 'number' && isFinite(v)) return v
      if (typeof v === 'string') { const n = Number(v); if (!isNaN(n)) return n }
    }
    return null
  }

  const nameOf = (o: any): string => String(o?.name ?? o?.outcomeName ?? o?.label ?? o?.type ?? '').toLowerCase()

  // Moneyline
  {
    const ml = byType.moneyline[0]
    if (ml) {
      let hp: number | null = null, ap: number | null = null, dp: number | null = null
      for (const o of outcomesOf(ml)) {
        const n = nameOf(o)
        const price = toAmerican(o?.price ?? o)
        if (price == null) continue
        if (n === 'draw' || n === 'tie' || n === 'x') dp = price
        else if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n))) hp = price
        else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n))) ap = price
        else if (n === '1') hp = price
        else if (n === '2') ap = price
      }
      if (hp != null || ap != null || dp != null) {
        out.push({
          marketType: 'moneyline',
          homePrice: hp, awayPrice: ap, drawPrice: dp,
          spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
        })
      }
    }
  }

  // Spread — pick the group whose outcome prices are closest to -110.
  {
    let best: { hp: number | null; ap: number | null; spread: number | null } | null = null
    let bestScore = Infinity
    for (const g of byType.spread) {
      let hp: number | null = null, ap: number | null = null, spread: number | null = null
      for (const o of outcomesOf(g)) {
        const n = nameOf(o)
        const price = toAmerican(o?.price ?? o)
        const line = lineOf(o)
        if (price == null) continue
        if (home && (n.includes(home.toLowerCase()) || home.toLowerCase().includes(n) || n === '1')) {
          hp = price; if (spread == null && line != null) spread = line
        } else if (away && (n.includes(away.toLowerCase()) || away.toLowerCase().includes(n) || n === '2')) {
          ap = price; if (spread == null && line != null) spread = -line
        }
      }
      if (hp == null && ap == null) continue
      const score = Math.abs((hp ?? -110) + 110) + Math.abs((ap ?? -110) + 110)
      if (score < bestScore) { bestScore = score; best = { hp, ap, spread } }
    }
    if (best) {
      out.push({
        marketType: 'spread',
        homePrice: best.hp, awayPrice: best.ap, drawPrice: null,
        spreadValue: best.spread, totalValue: null, overPrice: null, underPrice: null,
      })
    }
  }

  // Total
  {
    let best: { op: number | null; up: number | null; total: number | null } | null = null
    let bestScore = Infinity
    for (const g of byType.total) {
      let op: number | null = null, up: number | null = null, total: number | null = null
      for (const o of outcomesOf(g)) {
        const n = nameOf(o)
        const price = toAmerican(o?.price ?? o)
        const line = lineOf(o)
        if (price == null) continue
        if (n.startsWith('over') || n === 'o') { op = price; if (total == null) total = line }
        else if (n.startsWith('under') || n === 'u') { up = price; if (total == null) total = line }
      }
      if (op == null && up == null) continue
      const score = Math.abs((op ?? -110) + 110) + Math.abs((up ?? -110) + 110)
      if (score < bestScore) { bestScore = score; best = { op, up, total } }
    }
    if (best) {
      out.push({
        marketType: 'total',
        homePrice: null, awayPrice: null, drawPrice: null, spreadValue: null,
        totalValue: best.total,
        overPrice: best.op, underPrice: best.up,
      })
    }
  }

  return out
}

export const tonybetAdapter: BookAdapter = {
  slug: 'tonybet',
  name: 'TonyBet (Ontario)',
  pollIntervalSec: 300,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      // Passive capture of /api/event/list responses as the SPA fetches them.
      // Also record every JSON path on platform.tonybet.(com|ca) so we can
      // find the odds/markets endpoint (event list ships no odds inline).
      const listBodies: string[] = []
      const seenJsonHosts = new Map<string, number>()
      const seenPlatformPaths = new Map<string, number>()
      const responseHandler = async (resp: import('playwright').Response) => {
        const u = resp.url()
        const ct = (resp.headers()['content-type'] ?? '').toLowerCase()
        if (ct.includes('json')) {
          try {
            const parsed = new URL(u)
            seenJsonHosts.set(parsed.host, (seenJsonHosts.get(parsed.host) ?? 0) + 1)
            if (/platform\.tonybet\.(com|ca)$/i.test(parsed.host)) {
              const shape = parsed.pathname
                .replace(/\/\d{3,}/g, '/:id')
                .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
              seenPlatformPaths.set(shape, (seenPlatformPaths.get(shape) ?? 0) + 1)
            }
          } catch { /* ignore */ }
        }
        // Broadened: any event-list-shaped path on any tonybet host qualifies.
        // Earlier versions hardcoded platform.tonybet.com; the CA product may
        // serve from a different subdomain under the same path convention.
        if (!/tonybet\.[a-z]+\/api\/(event|events?)\/list/i.test(u)) return
        if (resp.status() !== 200) return
        try { listBodies.push(await resp.text()) } catch { /* stream closed */ }
      }
      page.on('response', responseHandler)

      log.info('tonybet seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('tonybet nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        page.off('response', responseHandler)
        return { events: scraped, errors }
      }
      await page.waitForTimeout(15_000)

      // Drive the SPA to each sport page — this is what causes event/list to fire.
      for (const s of SPORT_PATHS) {
        if (signal.aborted) break
        try {
          await page.goto(`https://tonybet.com/en-ca/sport/${s.path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(7_000)
        } catch (e: any) {
          log.warn('sport page nav failed', { path: s.path, message: e?.message ?? String(e) })
        }
      }
      page.off('response', responseHandler)
      log.info('tonybet captured', {
        listResponses: listBodies.length,
        jsonHostsSeen: Array.from(seenJsonHosts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15),
        topPlatformPaths: Array.from(seenPlatformPaths.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20),
      })

      // Parse all captured bodies, dedupe by event id, and attach a league.
      const seen = new Set<string>()
      let loggedSample = false
      for (const body of listBodies) {
        let json: any
        try { json = JSON.parse(body) } catch { continue }
        const items: TonyBetEvent[] = json?.data?.items ?? json?.items ?? []
        if (!Array.isArray(items)) continue

        // Unconditional raw dump of the first item we see each run, even
        // if extraction later fails — we need to see what fields BetConstruct
        // ships so the extractTeams/extractStart/league lookup can target
        // them correctly.
        if (!loggedSample && items.length > 0) {
          loggedSample = true
          const first = items[0]
          log.info('tonybet raw sample', {
            keys: Object.keys(first).slice(0, 40),
            body: JSON.stringify(first).slice(0, 2500),
          })
        }

        for (const item of items) {
          const id = String(item.id ?? (item as any).sbEventId ?? '')
          if (!id || seen.has(id)) continue

          const slug = typeof item.translationSlug === 'string' ? item.translationSlug : ''
          const sportId = typeof item.sportId === 'number' ? item.sportId : undefined
          const classified = leagueFromSlug(slug, sportId)
          if (!classified || !classified.leagueSlug) continue   // only keep NBA/MLB/NHL for v1

          const teams = extractTeams(item)
          const startIso = extractStartIso(item)
          if (!teams || !startIso) continue
          const sportMatch = {
            leagueSlug: classified.leagueSlug,
            sport: classified.sport,
          }

          seen.add(id)
          const gameMarkets = extractGameMarkets(item, teams.home, teams.away)
          const event: NormalizedEvent = {
            externalId: id,
            homeTeam: teams.home,
            awayTeam: teams.away,
            startTime: startIso,
            leagueSlug: sportMatch.leagueSlug,
            sport: sportMatch.sport,
          }
          scraped.push({ event, gameMarkets, props: [] })
        }
      }

      log.info('tonybet scrape summary', {
        events: scraped.length,
        totalGameMkts: scraped.reduce((s, e) => s + e.gameMarkets.length, 0),
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
