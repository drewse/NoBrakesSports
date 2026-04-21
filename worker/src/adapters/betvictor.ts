/**
 * BetVictor (Ontario) — discovery-mode adapter.
 *
 * Platform: BetVictor's own stack. CA front-end lives at betvictor.com/en-ca
 * (redirects to the CA-ON build). Capture XHRs to identify the event and
 * market feed endpoints.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://www.betvictor.com/en-ca/sports'

export const betvictorAdapter: BookAdapter = {
  slug: 'betvictor',
  name: 'BetVictor (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['betvictor.com', 'betvictor.ca'],
        bookSlug: 'betvictor',
        maxBodyBytes: 300,
      })

      log.info('betvictor seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('betvictor nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball/nba', 'baseball/mlb', 'ice-hockey/nhl']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://www.betvictor.com/en-ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'betvictor', captured)
      log.info('betvictor discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
