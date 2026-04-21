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

const SEED_URL = 'https://ca.888sport.com/sports'

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
        hostIncludes: ['888sport.com', 'kambi.com', 'kambicdn.com'],
        bookSlug: '888sport',
        maxBodyBytes: 300,
      })

      log.info('888sport seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('888sport nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball/nba', 'baseball/mlb', 'ice-hockey/nhl']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://ca.888sport.com/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, '888sport', captured)
      log.info('888sport discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
