/**
 * FanDuel (Ontario) — discovery-mode adapter.
 *
 * FanDuel historically exposes a public sportsbook API at
 *   sbapi.ca.sportsbook.fanduel.com / sportsbook-us-*.sportsbook.fanduel.com
 * with competition/event payloads under /api/...
 *
 * This pass captures every JSON XHR the SPA fires and summarizes them so
 * we can pick the right endpoint(s) to parse in a follow-up change.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://sportsbook.fanduel.com/navigation/nba'

export const fanduelAdapter: BookAdapter = {
  slug: 'fanduel_on',
  name: 'FanDuel (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        // Several FD subdomains carry event data — cast a wide net for intel.
        hostIncludes: ['sportsbook.fanduel.com', 'sbapi.', 'fanduel.com/api'],
        bookSlug: 'fanduel_on',
        maxBodyBytes: 300,
      })

      log.info('fanduel seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('fanduel nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(25_000)
      detach()

      logXhrSummary(log, 'fanduel_on', captured)
      log.info('fanduel discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
