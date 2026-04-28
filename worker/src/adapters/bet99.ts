/**
 * Bet99 (Ontario) — DGC / SBTech platform.
 *
 * Reconnaissance findings:
 *   - The SPA at bet99.com is reachable from datacenter IPs (no CF block).
 *   - Bet99 runs on the DGC abetting.co platform (formerly SBTech).
 *     window.config exposes endpoints:
 *       api      → "sportsbook/v1/api"        (REST, all routes 401 anon)
 *       socket   → "sportsbook-streaming-ws"  (WebSocket, all sports data)
 *   - Every REST path the bundled SPA references — sports, events,
 *     markets — returns 401 without an authenticated session. The only
 *     unauthenticated endpoint is /sportsbook/api/public/icons.
 *   - Sports data flows over the streaming WebSocket. Bet99's frontend
 *     subscribes to channels for prematch/live and receives diffed
 *     odds frames in DGC's proprietary message format.
 *
 * Implication:
 *   We cannot scrape bet99 events without an authenticated bet99
 *   account session. From a cron, that requires either:
 *     (a) a real account whose cookies + JWT we keep refreshed, or
 *     (b) a DGC partner API key (not publicly available).
 *
 *   This adapter therefore runs in CAPTURE mode — Playwright loads
 *   the SPA via CA mobile proxy, listens to BOTH XHR responses and
 *   raw WebSocket frames, and dumps a structured manifest to Railway
 *   logs. When/if account access is wired up, that capture tells us
 *   the exact channel subscriptions + message shapes to parse.
 *
 *   Returns 0 events. Will not generate phantom data.
 */

import { withPage } from '../lib/browser.js'
import { attachXhrCapture, logXhrSummary } from '../lib/discovery.js'
import type { BookAdapter } from '../lib/adapter.js'

const SEED_URL = 'https://www.bet99.com/en/sports'
const LEAGUE_PATHS = ['basketball', 'baseball', 'ice-hockey']

interface WsFrameSample {
  url: string
  direction: 'sent' | 'received'
  preview: string
  bytes: number
}

export const bet99Adapter: BookAdapter = {
  slug: 'bet99',
  name: 'Bet99 (Ontario) [discovery]',
  pollIntervalSec: 7200,  // 2h — no real data flowing yet, cap proxy spend
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const { captured, detach } = attachXhrCapture(page, log, {
        hostIncludes: ['bet99.com', 'bet99.ca', 'abetting.co'],
        bookSlug: 'bet99',
        maxBodyBytes: 400,
      })

      // ── WebSocket frame capture ────────────────────────────────────────
      // page.on('websocket') fires for each WS connection. We tap into
      // each one's framesent / framereceived events, capture a small
      // sample of the first ~5 frames per direction per socket, and
      // dump a summary to logs. The streaming protocol is what we'd
      // need to decode for live odds.
      const wsSamples: WsFrameSample[] = []
      const wsConnections = new Map<string, { sent: number; received: number }>()
      page.on('websocket', (ws) => {
        const url = ws.url()
        wsConnections.set(url, { sent: 0, received: 0 })
        ws.on('framesent', ({ payload }) => {
          const counters = wsConnections.get(url)!
          counters.sent++
          if (counters.sent <= 5) {
            const text = typeof payload === 'string' ? payload : payload.toString('utf8', 0, Math.min(200, payload.length))
            wsSamples.push({ url, direction: 'sent', preview: text.slice(0, 200), bytes: typeof payload === 'string' ? payload.length : payload.length })
          }
        })
        ws.on('framereceived', ({ payload }) => {
          const counters = wsConnections.get(url)!
          counters.received++
          if (counters.received <= 5) {
            const text = typeof payload === 'string' ? payload : payload.toString('utf8', 0, Math.min(200, payload.length))
            wsSamples.push({ url, direction: 'received', preview: text.slice(0, 200), bytes: typeof payload === 'string' ? payload.length : payload.length })
          }
        })
      })

      log.info('bet99 capture pass starting', { url: SEED_URL })
      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      } catch (e: any) {
        log.error('bet99 nav failed', { message: e?.message ?? String(e) })
        errors.push(`nav: ${e?.message ?? e}`)
        detach()
        return { events: [], errors }
      }

      // Let the SPA bootstrap, fire its WebSocket handshake, and
      // start streaming.
      await page.waitForTimeout(15_000)

      // Visit league pages — each visit triggers a fresh WS subscribe
      // for that league's events. Capturing those subscribe frames
      // tells us the channel naming convention DGC uses.
      for (const path of LEAGUE_PATHS) {
        if (signal.aborted) break
        try {
          await page.goto(`https://www.bet99.com/en/sports/${path}`, {
            waitUntil: 'domcontentloaded', timeout: 30_000,
          })
          await page.waitForTimeout(8_000)
        } catch { /* ignore */ }
      }

      detach()

      // Diagnostic — dump XHR + WS captures to Railway logs so the next
      // iteration can target the wire protocol.
      logXhrSummary(log, 'bet99', captured)
      log.info('bet99 ws connections', {
        count: wsConnections.size,
        connections: [...wsConnections.entries()].map(([url, c]) => ({ url, ...c })),
      })
      if (wsSamples.length > 0) {
        log.info('bet99 ws frame samples', {
          totalFrames: wsSamples.length,
          samples: wsSamples.slice(0, 12),  // cap log size
        })
      }
      log.info('bet99 capture summary', {
        xhrsCaptured: captured.length,
        wsConnections: wsConnections.size,
        wsFramesCaptured: wsSamples.length,
        notes: 'Sports data flows over websocket only — REST returns 401 anon. Adapter parked until account session wiring lands.',
      })

      return { events: [], errors }
    }, { useProxy: 'mobile' })
  },
}
