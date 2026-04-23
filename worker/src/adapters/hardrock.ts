/**
 * Hard Rock Bet — Playwright (US mobile proxy).
 *
 * US footprint: FL (dominant), NJ, IN, OH, TN, VA, AZ. Runs on Hard Rock
 * Digital's own stack (ex-Unibet Kindred engineers rebuilt it post the
 * Kindred US exit). Cloudflare-gated with explicit "disable VPN or WiFi"
 * error codes (CF_WAF_A_CR_DFD7) on any flagged CIDR — so requires a real
 * Chromium session routed through an IPRoyal-class mobile endpoint.
 *
 * API surface (captured from app.hardrock.bet DevTools):
 *   GET /api/sportsbook/v1/sports/{sport}/leagues/{league}/events
 *       — returns event list with basic markets
 *   GET /api/sportsbook-stream/v1/matches/upcoming?sportName={sport}
 *       — upcoming fixtures stream, includes moneyline/spread/total
 *
 * Shape isn't fully reverse-engineered yet — this adapter runs in
 * discovery mode: seeds the app, captures every /api/sportsbook and
 * /api/sportsbook-stream XHR, logs the top path patterns + one sample
 * body per distinct path so the next iteration can wire a parser.
 * Gated by HARD_ROCK_ENABLED=1 until US mobile proxy is funded.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, ScrapedEvent } from '../lib/types.js'

const SEED_URL = 'https://app.hardrock.bet/sports'
const API_HOST_RE = /app\.hardrock\.bet\/api\//i

// League landing pages — visiting these triggers the SPA's own XHRs for
// per-league event lists + markets, which we passively capture.
const LEAGUE_URLS: Array<{ url: string; leagueSlug: string; sport: string }> = [
  { url: 'https://app.hardrock.bet/sports/basketball/nba',    leagueSlug: 'nba', sport: 'basketball' },
  { url: 'https://app.hardrock.bet/sports/baseball/mlb',      leagueSlug: 'mlb', sport: 'baseball' },
  { url: 'https://app.hardrock.bet/sports/hockey/nhl',        leagueSlug: 'nhl', sport: 'ice_hockey' },
  { url: 'https://app.hardrock.bet/sports/football/nfl',      leagueSlug: 'nfl', sport: 'football' },
]

export const hardRockAdapter: BookAdapter = {
  slug: 'hard_rock_bet',
  name: 'Hard Rock Bet',
  pollIntervalSec: 900,   // 15 min during discovery, revisit once parser lands
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    if (process.env.HARD_ROCK_ENABLED !== '1') {
      log.info('skipped — set HARD_ROCK_ENABLED=1 + MOBILE_PROXY_URL_US to activate')
      return { events: [], errors: [] }
    }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapedEvent[] = []

      const seenPaths = new Map<string, number>()
      const sampleBodies = new Map<string, string>()   // path-pattern → first body

      page.on('response', async (resp) => {
        const u = resp.url()
        if (!API_HOST_RE.test(u)) return
        try {
          const path = new URL(u).pathname
            .replace(/\/[0-9a-f-]{36}/gi, '/:uuid')
            .replace(/\/\d{3,}/g, '/:id')
          seenPaths.set(path, (seenPaths.get(path) ?? 0) + 1)
          if (resp.status() === 200 && !sampleBodies.has(path) && sampleBodies.size < 10) {
            try { sampleBodies.set(path, (await resp.text()).slice(0, 2500)) } catch { /* body closed */ }
          }
        } catch { /* non-URL */ }
      })

      log.info('seeding hardrock session', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
        await page.waitForTimeout(3_000)   // let CF cookies settle + initial XHRs fire
      } catch (e: any) {
        errors.push(`seed: ${e?.message ?? String(e)}`)
        return { events: scraped, errors }
      }

      // Visit each league page — the SPA fires league-specific event calls
      // that we capture.
      for (const lg of LEAGUE_URLS) {
        if (signal.aborted) break
        try {
          await page.goto(lg.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await page.waitForTimeout(3_500)
        } catch (e: any) {
          errors.push(`${lg.leagueSlug} nav: ${e?.message ?? String(e)}`)
        }
      }

      log.info('hardrock discovery', {
        distinctPaths: seenPaths.size,
        topPaths: [...seenPaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
      })
      for (const [path, body] of sampleBodies) {
        log.info('hardrock sample body', { path, len: body.length, preview: body.slice(0, 500) })
      }

      // Parser not yet wired — we're in discovery mode. Next iteration:
      // inspect logged samples, pick the event-list + markets endpoints,
      // write mapEvent / extractMarkets functions, populate scraped[].

      return { events: scraped, errors }
    }, { useProxy: 'us-mobile', rotateSession: true })
  },
}
