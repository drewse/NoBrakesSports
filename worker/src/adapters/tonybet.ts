/**
 * TonyBet (Ontario) — discovery-mode adapter.
 *
 * TonyBet's CA front-end lives at tonybet.com/ca-on (or tonybet.ca). Platform
 * is their own build atop a white-label stack (BetConstruct historically).
 * Discovery pass catalogs XHRs for parser targeting.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://tonybet.com/en-ca/sport'

export const tonybetAdapter: BookAdapter = {
  slug: 'tonybet',
  name: 'TonyBet (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['tonybet.com', 'tonybet.ca', 'betconstruct.com'],
        bookSlug: 'tonybet',
        maxBodyBytes: 300,
      })

      log.info('tonybet seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('tonybet nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball', 'baseball', 'ice-hockey']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://tonybet.com/en-ca/sport/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'tonybet', captured)
      log.info('tonybet discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
