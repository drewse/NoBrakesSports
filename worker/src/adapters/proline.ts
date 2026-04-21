/**
 * PROLINE+ (OLG, Ontario) — discovery-mode adapter.
 *
 * OLG's sportsbook platform is a custom build; front-end lives at
 * proline.olg.ca. First pass captures every JSON XHR so we can identify the
 * events-list and event-detail shapes for a real parser.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://proline.olg.ca/en-ca/sports'

export const prolineAdapter: BookAdapter = {
  slug: 'proline',
  name: 'PROLINE+ (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['proline.olg.ca', 'olg.ca'],
        bookSlug: 'proline',
        maxBodyBytes: 300,
      })

      log.info('proline seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('proline nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      // Give the SPA time to hydrate, fire navigation XHRs, and load at least
      // one league's events.
      await page.waitForTimeout(20_000)

      // Click into each major sport to fan out XHRs. Best-effort; skip on miss.
      for (const path of ['basketball', 'baseball', 'hockey']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://proline.olg.ca/en-ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'proline', captured)
      log.info('proline discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
