/**
 * Bally Bet (Ontario) — discovery-mode adapter.
 *
 * The live CA sportsbook is served from play.ballybet.ca behind a hash-based
 * SPA (`#sports-hub/<sport>/<league>`). Capture XHRs on the NBA deep link so
 * we can identify the event + market feed before writing a real parser.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_CANDIDATES = [
  'https://play.ballybet.ca/sports#sports-hub/basketball/nba',
  'https://play.ballybet.ca/sports',
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
          'ballybet.ca', 'ballybet.com', 'ballybetca.com',
          'kambi.com', 'kambicdn.com',
          // White-label platforms ballybet has used historically:
          'bragg.com', 'sgdigital.com', 'sbtech.com', 'digital-gaming.com',
        ],
        bookSlug: 'ballybet',
        maxBodyBytes: 1200,
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
