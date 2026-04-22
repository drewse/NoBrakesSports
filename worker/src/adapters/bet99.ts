/**
 * Bet99 (Ontario) — discovery-mode adapter.
 *
 * Bet99 runs on the SBTech / Digital Gaming Corp (Entain) stack. CA product
 * lives at bet99.com — discovery pass catalogs XHRs to identify the event
 * feed endpoint.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://www.bet99.com/en/sports'

export const bet99Adapter: BookAdapter = {
  slug: 'bet99',
  name: 'Bet99 (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['bet99.com', 'bet99.ca'],
        bookSlug: 'bet99',
        maxBodyBytes: 300,
      })

      log.info('bet99 seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('bet99 nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball', 'baseball', 'ice-hockey']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://www.bet99.com/en/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'bet99', captured)
      log.info('bet99 discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: 'mobile' })
  },
}
