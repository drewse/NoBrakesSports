/**
 * 888sport (Ontario) — discovery-mode adapter.
 *
 * 888sport runs on the Kambi platform (client id varies by region). CA front
 * end at ca.888sport.com. Expected public endpoint family:
 *   https://*.kambicdn.com/offering/v2018/<clientId>/...
 * Discovery captures all XHRs so we can confirm the clientId + endpoint paths.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_CANDIDATES = [
  'https://www.888sport.ca/basketball/united-states/nba-t-563941/',
  'https://www.888sport.ca/',
]

export const eightyEightSportAdapter: BookAdapter = {
  slug: '888sport',
  name: '888sport (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['888sport.com', '888sport.ca', 'kambi.com', 'kambicdn.com'],
        bookSlug: '888sport',
        maxBodyBytes: 1200,
      })

      let loaded = false
      for (const url of SEED_CANDIDATES) {
        if (signal.aborted) break
        try {
          log.info('888sport seeding', { url })
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          loaded = true
          break
        } catch (e: any) {
          log.warn('888sport seed candidate failed', {
            url, message: e?.message ?? String(e),
          })
        }
      }
      if (!loaded) {
        errors.push('all seed candidates failed')
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(25_000)

      detach()
      logXhrSummary(log, '888sport', captured)
      log.info('888sport discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
