/**
 * theScore Bet (Ontario) — discovery-mode adapter.
 *
 * theScore Bet runs on Penn Interactive's sportsbook platform (post-ESPN BET
 * transition, the CA product kept the original "theScore Bet" branding).
 * Front-end is at on.thescorebet.ca. Goal of this pass is to catalog the
 * XHR shapes the SPA fires so we can pick a parser target.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://on.thescorebet.ca/sports/basketball/nba'

export const thescoreAdapter: BookAdapter = {
  slug: 'thescore',
  name: 'theScore Bet (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['thescorebet.ca', 'thescore.com', 'penngaming.com'],
        bookSlug: 'thescore',
        maxBodyBytes: 300,
      })

      log.info('thescore seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('thescore nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball/nba', 'baseball/mlb', 'hockey/nhl']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://on.thescorebet.ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'thescore', captured)
      log.info('thescore discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
