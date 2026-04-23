/**
 * BetOnline / LowVig (shared offshore SAS platform) — Playwright edition.
 *
 * The api-offering.betonline.ag JSON endpoint sits behind Cloudflare. Both
 * datacenter IPs (Vercel) and residential proxy IPs (PacketStream CA + US)
 * return 403 with Cloudflare's "Internal Error" HTML — the wall is on
 * TLS/JA3 fingerprint, not geography. A real Chromium session with cookies
 * set from the branded front-end passes; page.evaluate then POSTs to the
 * JSON endpoint using the same session.
 *
 * Endpoint (captured from DevTools cURL):
 *   POST https://api-offering.betonline.ag/api/offering/Sports/offering-by-league
 *   Body: { Sport, League, ScheduleText: null, filterTime: 0 }
 *   Header: `gsetting` picks the operator — bolsassite / lvsassite.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, ScrapedEvent } from '../lib/types.js'

interface Operator {
  slug: string
  name: string
  origin: string    // CORS origin + seed URL host
  seedUrl: string   // front-end page to visit so CF cookies are set
  gsetting: string  // identifies the SAS site to api-offering
}

const OPERATORS: Operator[] = [
  { slug: 'betonline', name: 'BetOnline',
    origin: 'https://www.betonline.ag',
    seedUrl: 'https://www.betonline.ag/sportsbook',
    gsetting: 'bolsassite' },
  { slug: 'lowvig', name: 'LowVig',
    origin: 'https://www.lowvig.ag',
    seedUrl: 'https://www.lowvig.ag/sportsbook',
    gsetting: 'lvsassite' },
  // Third site on the same SAS platform as BetOnline/LowVig. gsetting value
  // is inferred from the SAS naming pattern (bol/lv → sb); if the first
  // scrape logs HTTP 403 "invalid site" the gsetting needs correcting from
  // a live DevTools capture of sportsbetting.ag.
  { slug: 'sportsbetting_ag', name: 'Sportsbetting.ag',
    origin: 'https://www.sportsbetting.ag',
    seedUrl: 'https://www.sportsbetting.ag/sportsbook',
    gsetting: 'sbsassite' },
]

const API_URL = 'https://api-offering.betonline.ag/api/offering/Sports/offering-by-league'

const LEAGUES: Array<{ sport: string; league: string; leagueSlug: string; canonicalSport: string }> = [
  { sport: 'basketball', league: 'nba', leagueSlug: 'nba', canonicalSport: 'basketball' },
  { sport: 'baseball',   league: 'mlb', leagueSlug: 'mlb', canonicalSport: 'baseball' },
  { sport: 'hockey',     league: 'nhl', leagueSlug: 'nhl', canonicalSport: 'ice_hockey' },
  { sport: 'football',   league: 'nfl', leagueSlug: 'nfl', canonicalSport: 'football' },
]

function parseAmerican(v: any): number | null {
  if (v == null) return null
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null
  const s = String(v).trim()
  if (!s || s === 'PK' || s === 'pk') return 100
  const n = parseInt(s.replace(/^\+/, ''), 10)
  return isNaN(n) ? null : n
}

function parseNumber(v: any): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isFinite(n) ? n : null
}

/** Walk body collecting event-shaped nodes. BetOnline wraps events inside
 *  nested league groups; look for anything with participants/competitors/teams
 *  plus markets/lines/offerings. */
function collectEvents(node: any): any[] {
  const out: any[] = []
  const seen = new WeakSet()
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return
    if (seen.has(n)) return
    seen.add(n)
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    const keys = Object.keys(n)
    const hasParts = keys.includes('participants') || keys.includes('competitors') || keys.includes('teams')
    const hasMarkets = keys.includes('markets') || keys.includes('lines') || keys.includes('offerings')
    const hasTitle = keys.includes('title') || keys.includes('description') || keys.includes('name')
    if ((hasParts && hasMarkets) || (hasMarkets && hasTitle && (n.id || n.EventId || n.eventId))) {
      out.push(n)
    }
    for (const v of Object.values(n)) walk(v)
  }
  walk(node)
  return out
}

function mapEvent(ev: any, lg: typeof LEAGUES[number]): ScrapedEvent | null {
  const externalId = String(ev.id ?? ev.EventId ?? ev.eventId ?? '')
  if (!externalId) return null
  const raw = ev.startTime ?? ev.startDate ?? ev.eventDate ?? ev.starts ?? ev.date
  const startTime = typeof raw === 'number' ? new Date(raw).toISOString()
    : typeof raw === 'string' ? new Date(raw).toISOString()
    : null
  if (!startTime) return null

  let home: string | undefined, away: string | undefined
  if (Array.isArray(ev.participants)) {
    home = ev.participants.find((p: any) => p?.home || p?.isHome || p?.side === 'home')?.name
    away = ev.participants.find((p: any) => p?.away || (!p?.home && !p?.isHome))?.name
    if (!home && ev.participants.length === 2) { away = ev.participants[0]?.name; home = ev.participants[1]?.name }
  } else if (ev.teams && (ev.teams.home || ev.teams.away)) {
    home = ev.teams.home?.name
    away = ev.teams.away?.name
  } else if (Array.isArray(ev.competitors)) {
    home = ev.competitors.find((c: any) => c?.home || c?.isHome)?.name
    away = ev.competitors.find((c: any) => !(c?.home || c?.isHome))?.name
  }
  if ((!home || !away) && (ev.title || ev.description || ev.name)) {
    const title = String(ev.title ?? ev.description ?? ev.name)
    const at = title.search(/\s+@\s+|\s+at\s+/i)
    if (at > 0) { away = title.slice(0, at).trim(); home = title.replace(/^[^@]+(?:@|at)\s+/i, '').trim() }
  }
  if (!home || !away) return null

  const markets = Array.isArray(ev.markets) ? ev.markets
    : Array.isArray(ev.lines) ? ev.lines
    : Array.isArray(ev.offerings) ? ev.offerings
    : []

  const pickByType = (typeMatch: RegExp) => {
    for (const m of markets) {
      const label = String(m?.description ?? m?.name ?? m?.title ?? m?.marketType ?? '').toLowerCase()
      if (typeMatch.test(label)) return m
    }
    return null
  }

  const gm: GameMarket[] = []

  const ml = pickByType(/^money\s*line|^moneyline|match\s*winner/)
  if (ml) {
    let hp: number | null = null, ap: number | null = null
    for (const o of (ml.outcomes ?? ml.selections ?? ml.participants ?? [])) {
      const name = String(o?.description ?? o?.name ?? '').toLowerCase()
      const price = parseAmerican(o?.price?.american ?? o?.american ?? o?.americanOdds ?? o?.price)
      if (price == null) continue
      if (name.includes(home.toLowerCase()) || home.toLowerCase().includes(name)) hp = price
      else if (name.includes(away.toLowerCase()) || away.toLowerCase().includes(name)) ap = price
    }
    if (hp != null || ap != null) gm.push({
      marketType: 'moneyline',
      homePrice: hp, awayPrice: ap, drawPrice: null,
      spreadValue: null, totalValue: null, overPrice: null, underPrice: null,
    })
  }

  const spread = pickByType(/point\s*spread|\brun\s*line|\bpuck\s*line|\bspread\b|handicap/)
  if (spread) {
    let hp: number | null = null, ap: number | null = null, line: number | null = null
    for (const o of (spread.outcomes ?? spread.selections ?? spread.participants ?? [])) {
      const name = String(o?.description ?? o?.name ?? '').toLowerCase()
      const price = parseAmerican(o?.price?.american ?? o?.american ?? o?.americanOdds ?? o?.price)
      const hc = parseNumber(o?.handicap ?? o?.line ?? o?.points ?? o?.price?.handicap)
      if (price == null) continue
      if (name.includes(home.toLowerCase()) || home.toLowerCase().includes(name)) {
        hp = price; if (line == null && hc != null) line = hc
      } else if (name.includes(away.toLowerCase()) || away.toLowerCase().includes(name)) {
        ap = price
      }
    }
    if (hp != null || ap != null) gm.push({
      marketType: 'spread',
      homePrice: hp, awayPrice: ap, drawPrice: null,
      spreadValue: line, totalValue: null, overPrice: null, underPrice: null,
    })
  }

  const total = pickByType(/\btotal\b|over\/?under|totals/)
  if (total) {
    let op: number | null = null, up: number | null = null, line: number | null = null
    for (const o of (total.outcomes ?? total.selections ?? total.participants ?? [])) {
      const name = String(o?.description ?? o?.name ?? '').toLowerCase()
      const price = parseAmerican(o?.price?.american ?? o?.american ?? o?.americanOdds ?? o?.price)
      const hc = parseNumber(o?.handicap ?? o?.line ?? o?.points ?? o?.total ?? o?.price?.handicap)
      if (price == null) continue
      if (/^over|^o$/.test(name)) { op = price; if (line == null && hc != null) line = hc }
      else if (/^under|^u$/.test(name)) { up = price; if (line == null && hc != null) line = hc }
    }
    if (op != null || up != null) gm.push({
      marketType: 'total',
      homePrice: null, awayPrice: null, drawPrice: null,
      spreadValue: null, totalValue: line, overPrice: op, underPrice: up,
    })
  }

  return {
    event: {
      externalId,
      homeTeam: home,
      awayTeam: away,
      startTime,
      leagueSlug: lg.leagueSlug,
      sport: lg.canonicalSport,
    },
    gameMarkets: gm,
    props: [],
  }
}

function buildAdapter(op: Operator): BookAdapter {
  return {
    slug: op.slug,
    name: op.name,
    pollIntervalSec: 7200,  // 2h — cap IPRoyal US-mobile cost
    needsBrowser: true,

    async scrape({ signal, log }) {
      if (signal.aborted) return { events: [], errors: ['aborted'] }

      // Runs whenever a US proxy URL is configured on Railway. Prefers
      // MOBILE_PROXY_URL_US (IPRoyal), falls back to PROXY_URL_US
      // (PacketStream residential — free tier worth testing first: real
      // Chromium TLS through a residential IP sometimes clears CF where
      // curl-through-the-same-IP fails).
      if (!process.env.MOBILE_PROXY_URL_US && !process.env.PROXY_URL_US) {
        log.info('skipped — set PROXY_URL_US (PacketStream) or MOBILE_PROXY_URL_US (IPRoyal) on Railway to activate')
        return { events: [], errors: [] }
      }

      return withPage(async (page) => {
        const errors: string[] = []
        const scraped: ScrapedEvent[] = []

        log.info('seeding session', { url: op.seedUrl })
        try {
          await page.goto(op.seedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          // Let CF issue clearance cookies + any anti-bot JS finish.
          await page.waitForTimeout(3_000)
        } catch (e: any) {
          errors.push(`seed: ${e?.message ?? String(e)}`)
          return { events: scraped, errors }
        }

        // page.evaluate + fetch() hits CORS because www.betonline.ag →
        // api-offering.betonline.ag is cross-origin. Use APIRequestContext
        // which runs outside the page's JS sandbox but shares cookies.
        const apiCtx = page.context().request

        for (const lg of LEAGUES) {
          if (signal.aborted) break

          let status = -1
          let bodyText = ''
          try {
            const resp = await apiCtx.post(API_URL, {
              headers: {
                'accept': 'application/json',
                'accept-language': 'en-US,en;q=0.9',
                'content-type': 'application/json',
                'gsetting': op.gsetting,
                'origin': op.origin,
                'utc-offset': '240',
              },
              data: { Sport: lg.sport, League: lg.league, ScheduleText: null, filterTime: 0 },
              timeout: 15_000,
            })
            status = resp.status()
            bodyText = await resp.text().catch(() => '')
          } catch (e: any) {
            status = -1
            bodyText = `request threw: ${e?.message ?? String(e)}`
          }

          if (status !== 200) {
            errors.push(`${lg.leagueSlug}: HTTP ${status}`)
            log.warn('league fetch non-200', { league: lg.leagueSlug, status, preview: bodyText.slice(0, 200) })
            continue
          }

          let body: any
          try { body = JSON.parse(bodyText) } catch {
            errors.push(`${lg.leagueSlug}: non-JSON body`)
            continue
          }

          const events = collectEvents(body)
          log.info('league', { league: lg.leagueSlug, rawEvents: events.length })
          for (const ev of events) {
            const mapped = mapEvent(ev, lg)
            if (mapped) scraped.push(mapped)
          }
        }

        return { events: scraped, errors }
      }, { useProxy: 'us-mobile', rotateSession: true })
    },
  }
}

export const betonlineAdapter: BookAdapter = buildAdapter(OPERATORS[0])
export const lowvigAdapter: BookAdapter = buildAdapter(OPERATORS[1])
export const sportsbettingAgAdapter: BookAdapter = buildAdapter(OPERATORS[2])
