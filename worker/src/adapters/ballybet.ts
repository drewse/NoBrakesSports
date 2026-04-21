/**
 * Bally Bet (Ontario) — discovery-mode adapter.
 *
 * Bally Bet CA front-end at ballybet.ca. Platform: formerly Kambi, rebuilt
 * on White Hat / custom stack for CA-ON. Discovery captures XHR shapes.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://ballybet.ca/sports'

export const ballybetAdapter: BookAdapter = {
  slug: 'ballybet',
  name: 'Bally Bet (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['ballybet.ca', 'ballybet.com', 'kambi.com', 'kambicdn.com'],
        bookSlug: 'ballybet',
        maxBodyBytes: 300,
      })

      log.info('ballybet seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('ballybet nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball/nba', 'baseball/mlb', 'ice-hockey/nhl']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://ballybet.ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'ballybet', captured)
      log.info('ballybet discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
