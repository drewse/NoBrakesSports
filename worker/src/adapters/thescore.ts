/**
 * theScore Bet (Ontario) — discovery-mode adapter.
 *
 * The real sportsbook host is sportsbook.thescore.bet (Penn Interactive) and
 * the API lives at sportsbook.ca-on.thescore.bet/graphql/persisted_queries/
 * — requires an x-anonymous-authorization Bearer JWT that the SPA mints
 * on first load. Our previous seed (on.thescorebet.ca) tunnel-fails; the
 * public product domain does load.
 *
 * This pass captures XHRs on those hosts so a real parser can target the
 * CompetitionPageSectionLinesTabNode persisted query.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://sportsbook.thescore.bet/basketball/nba'

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
        hostIncludes: [
          'thescore.bet', 'ca-on.thescore.bet', 'thescorebet.ca',
          'penngaming.com',
        ],
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
          await page.goto(`https://sportsbook.thescore.bet/${path}`, {
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
