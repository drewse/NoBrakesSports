/**
 * BetMGM (Ontario) — discovery-mode adapter.
 *
 * Goal of this pass: navigate to the sportsbook, capture every api.* XHR
 * the SPA fires, and log a grouped summary so we can identify which endpoint
 * carries events/markets. Once the real URL shape is known, swap in a
 * targeted parser.
 *
 * No DB writes yet — returns { events: [], errors: [...] } every run.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

// BetMGM Ontario public sportsbook.
// NBA league root is a reasonable seed — forces the SPA to fire events XHRs.
const SEED_URL = 'https://sports.on.betmgm.ca/en/sports/basketball-7/betting/usa-9/nba-6004'

export const betmgmAdapter: BookAdapter = {
  slug: 'betmgm_on',
  name: 'BetMGM (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['betmgm.ca', 'bwin.com', 'betmgmbrand.com'],
        bookSlug: 'betmgm_on',
        maxBodyBytes: 300,
      })

      log.info('betmgm seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('betmgm nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      // Let the SPA idle — anti-bot + fully-rendered markets.
      await page.waitForTimeout(25_000)
      detach()

      logXhrSummary(log, 'betmgm_on', captured)
      log.info('betmgm discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
