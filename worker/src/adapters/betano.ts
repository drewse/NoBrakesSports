/**
 * Betano (Ontario) — discovery-mode adapter.
 *
 * Betano (Kaizen Gaming) runs a proprietary stack. CA front-end at betano.ca.
 * Discovery pass catalogs XHR shapes.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://www.betano.ca/sport/'

export const betanoAdapter: BookAdapter = {
  slug: 'betano',
  name: 'Betano (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['betano.ca', 'betano.com', 'kaizengaming.com'],
        bookSlug: 'betano',
        maxBodyBytes: 300,
      })

      log.info('betano seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('betano nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball', 'baseball', 'ice-hockey']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://www.betano.ca/sport/${path}/`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'betano', captured)
      log.info('betano discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
