/**
 * Bally Bet (Ontario) — discovery-mode adapter.
 *
 * ballybet.ca is casino-only (Gamesys static bundle) — confirmed on first
 * cycle, all 44 XHRs were JS chunks, zero sportsbook API calls. The CA
 * sportsbook lives at sports.ballybet.ca (or ballybetca.com, which
 * redirects). Discovery captures XHR shapes.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://sports.ballybet.ca/en/sports'

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
        ],
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
          await page.goto(`https://sports.ballybet.ca/en/sports/${path}`, {
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
