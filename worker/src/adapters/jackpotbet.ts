/**
 * JackpotBet (Ontario) — discovery-mode adapter.
 *
 * JackpotBet CA front-end at jackpotbet.ca. Smaller Ontario operator —
 * platform likely a BetConstruct / SBTech white-label. Discovery captures
 * XHR shapes for parser targeting.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://jackpotbet.ca/sports'

export const jackpotbetAdapter: BookAdapter = {
  slug: 'jackpotbet',
  name: 'JackpotBet (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['jackpotbet.ca', 'jackpotbet.com', 'betconstruct.com'],
        bookSlug: 'jackpotbet',
        maxBodyBytes: 300,
      })

      log.info('jackpotbet seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('jackpotbet nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball', 'baseball', 'ice-hockey']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://jackpotbet.ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'jackpotbet', captured)
      log.info('jackpotbet discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
