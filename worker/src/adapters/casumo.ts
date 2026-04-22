/**
 * Casumo (Ontario) — discovery-mode adapter.
 *
 * Casumo's CA sportsbook lives at casumo.com/en-ca/sports. Platform is a
 * Kambi white-label (clientId typically `casumo` / `casumoca`). Capture
 * XHRs to confirm the endpoint shape.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

// Deep-link directly to an NBA grid — the bare /sports route renders a
// promo page and doesn't fire sportsbook XHRs until the user drills in.
const SEED_URL = 'https://www.casumo.com/en-ca/sports/basketball/nba'

export const casumoAdapter: BookAdapter = {
  slug: 'casumo',
  name: 'Casumo (Ontario) [discovery]',
  pollIntervalSec: 600,
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      // Broad host filter — we don't know yet whether Casumo CA fronts Kambi,
      // their own API, or a third-party (Bragg, SGDigital). Capture JSON
      // responses from anywhere except obvious static CDNs so the discovery
      // summary surfaces the real sportsbook API.
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: [
          'casumo.com',
          'kambi.com', 'kambicdn.com', 'offering-api',
          'bragg.com', 'sgdigital.com', 'sbtech.com',
        ],
        bookSlug: 'casumo',
        maxBodyBytes: 1200,
        // Skip the static SPA bundle chunks that dominated the last capture.
        excludePath: /\/fabric-static-assets\/|\.js(\?|$)|\.css(\?|$)/,
      })

      log.info('casumo seeding', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('casumo nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }
      await page.waitForTimeout(20_000)

      for (const path of ['basketball/nba', 'baseball/mlb', 'ice-hockey/nhl']) {
        if (signal.aborted) break
        try {
          await page.goto(`https://www.casumo.com/en-ca/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(6_000)
        } catch { /* ignore */ }
      }

      detach()
      logXhrSummary(log, 'casumo', captured)
      log.info('casumo discovery run done', { xhrsCaptured: captured.length })
      return { events: [], errors }
    }, { useProxy: true })
  },
}
