/**
 * BetRivers (Ontario) — discovery-mode adapter.
 *
 * BetRivers/Rush Street uses the Kambi platform and exposes a public
 * offering endpoint at kambi.com. Payloads are typically JSON under
 * /offering/v2018/ with events and bet-offers inline.
 *
 * This discovery pass captures all JSON XHRs so we can pick the right
 * path shape for a future parser.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://on.betrivers.ca/?page=sportsbook#home'

export const betriversAdapter: BookAdapter = {
  slug: 'betrivers_on',
  name: 'BetRivers (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['betrivers.ca', 'kambi.com', 'kambicdn.com'],
        bookSlug: 'betrivers_on',
        maxBodyBytes: 300,
      })

      log.info('betrivers seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('betrivers nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(25_000)
      detach()

      logXhrSummary(log, 'betrivers_on', captured)
      log.info('betrivers discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
