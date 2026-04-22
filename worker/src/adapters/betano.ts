/**
 * Betano (Ontario) — passive-capture adapter with targeted diagnostic.
 *
 * Platform: Kaizen Gaming / My Betano. DevTools capture confirmed:
 *   - Base host: www.betano.ca
 *   - BetBuilder endpoint: /api/betbuilderplus/event?id=<eventId>&sportCode=BASK
 *   - League URL: /sport/basketball/leagues/441g/  (NBA = 441g)
 *
 * The bare /sport overview doesn't fire the event-list call — we need the
 * league drill-down. This pass navigates to each league page, captures all
 * /api/* JSON responses, and dumps a summary so we can identify the exact
 * event-list endpoint for the next iteration.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult } from '../lib/types.js'

// League IDs pulled from DevTools on betano.ca. NBA = 441g confirmed;
// MLB / NHL IDs are likely neighbors in the same letter-suffix scheme.
const LEAGUE_SEEDS: Array<{ url: string; leagueSlug: string; sport: string }> = [
  { url: 'https://www.betano.ca/sport/basketball/leagues/441g/', leagueSlug: 'nba', sport: 'basketball' },
  // Best-effort MLB / NHL seeds — the SPA may redirect to the correct
  // league if the ID shape is wrong, and we capture whatever XHRs fire.
  { url: 'https://www.betano.ca/sport/baseball/',   leagueSlug: 'mlb', sport: 'baseball' },
  { url: 'https://www.betano.ca/sport/ice-hockey/', leagueSlug: 'nhl', sport: 'ice_hockey' },
]

export const betanoAdapter: BookAdapter = {
  slug: 'betano',
  name: 'Betano (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const scraped: ScrapeResult['events'] = []

      // Capture everything under betano.ca/api/* with JSON content-type.
      // Track path shape + first-bytes sample so we can see which endpoint
      // actually carries the events list on the league page.
      interface Capture { path: string; bodyLen: number; topKeys: string[]; sample: string }
      const seenPaths = new Map<string, number>()
      const captures: Capture[] = []
      const responseHandler = async (resp: import('playwright').Response) => {
        const u = resp.url()
        if (!/^https:\/\/www\.betano\.ca\/api\//.test(u)) return
        const ct = (resp.headers()['content-type'] ?? '').toLowerCase()
        if (!ct.includes('json')) return
        if (resp.status() !== 200) return
        try {
          const text = await resp.text()
          const parsed = new URL(u)
          const shape = parsed.pathname.replace(/\/\d{3,}/g, '/:id')
          seenPaths.set(shape, (seenPaths.get(shape) ?? 0) + 1)
          if (captures.length < 20) {
            let topKeys: string[] = []
            try {
              const j = JSON.parse(text)
              if (Array.isArray(j)) topKeys = [`__array__len=${j.length}`]
              else if (j && typeof j === 'object') topKeys = Object.keys(j).slice(0, 12)
            } catch { /* non-JSON despite ct */ }
            captures.push({
              path: parsed.pathname + parsed.search.slice(0, 120),
              bodyLen: text.length,
              topKeys,
              sample: text.slice(0, 400),
            })
          }
        } catch { /* stream closed */ }
      }
      page.on('response', responseHandler)

      for (const seed of LEAGUE_SEEDS) {
        if (signal.aborted) break
        try {
          log.info('betano seeding', { url: seed.url })
          await page.goto(seed.url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          await page.waitForTimeout(8_000)
        } catch (e: any) {
          log.warn('betano nav failed', { url: seed.url, message: e?.message ?? String(e) })
        }
      }

      page.off('response', responseHandler)
      log.info('betano captured', {
        totalJsonCaptures: captures.length,
        topPaths: Array.from(seenPaths.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20),
      })

      // Dump up to 5 "interesting" bodies — ones with substantial size OR
      // top-level keys that look like event collections.
      const interesting = captures
        .filter(c =>
          c.bodyLen > 1000 ||
          c.topKeys.some(k => /event|market|leagu|match|fixture|tournament/i.test(k)),
        )
        .sort((a, b) => b.bodyLen - a.bodyLen)
        .slice(0, 5)
      for (const c of interesting) {
        log.info('betano sample body', {
          path: c.path,
          bodyLen: c.bodyLen,
          topKeys: c.topKeys,
          sample: c.sample,
        })
      }

      // No parser yet — next iteration once we know the events-list path.
      log.info('betano scrape summary', {
        events: 0,
        note: 'discovery pass — see betano sample body logs for next-iter target',
      })
      return { events: scraped, errors }
    }, { useProxy: true })
  },
}
