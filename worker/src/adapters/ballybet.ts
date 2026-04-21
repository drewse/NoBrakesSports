/**
 * Bally Bet (Ontario) — discovery-mode adapter.
 *
 * Bally Bet Ontario sportsbook has gone through several platform changes.
 * Gamesys brand (ballybet.ca) is casino-only; subdomain sports.ballybet.ca
 * doesn't resolve. Try the virginplusbet.ca landing (successor CA brand)
 * and sports-ballybet.com as fallbacks.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_CANDIDATES = [
  'https://virginplusbet.ca/en/sports',
  'https://www.ballybet.com/',
  'https://sportsbook.ballybet.ca/',
]

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
        hostIncludes: [
          'ballybet.ca', 'ballybet.com', 'ballybetca.com', 'virginplusbet.ca',
          'kambi.com', 'kambicdn.com',
        ],
        bookSlug: 'ballybet',
        maxBodyBytes: 300,
      })

      // Try each candidate URL until one resolves. PacketStream returns
      // ERR_TUNNEL_CONNECTION_FAILED on non-existent subdomains.
      let loaded = false
      for (const url of SEED_CANDIDATES) {
        if (signal.aborted) break
        try {
          log.info('ballybet seeding', { url })
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          loaded = true
          break
        } catch (e: any) {
          log.warn('ballybet seed candidate failed', {
            url, message: e?.message ?? String(e),
          })
        }
      }
      if (!loaded) {
        errors.push('all seed candidates failed')
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      detach()
      logXhrSummary(log, 'ballybet', captured)
      log.info('ballybet discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
