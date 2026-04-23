/**
 * Shared Playwright discovery helper for CF-gated offshore sportsbooks.
 *
 * All three new targets (MyBookie, Bookmaker.eu, BetUS) sit behind
 * Cloudflare WAF. A curl probe through PacketStream US 403s every time —
 * but a real Chromium session through the same proxy might pass, because
 * CF's Bot Management score combines IP reputation + TLS fingerprint +
 * JS challenge. Real Chrome clears JS + TLS even from a flagged-ish IP.
 *
 * Each adapter below runs in discovery mode on first deploy:
 *   1. Open PacketStream US context (blocks images/fonts automatically)
 *   2. Visit the sportsbook landing page, let CF cookies settle
 *   3. Navigate to NBA / MLB / NHL league pages
 *   4. Passively capture every /api/* or JSON XHR URL + sample bodies
 *
 * From the captured sample bodies we wire the real parser on iteration 2.
 * If the landing page 403s outright, we log the status so we know to
 * escalate to mobile proxy for that specific book.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, ScrapedEvent } from '../lib/types.js'

export interface OffshoreProbeConfig {
  slug: string
  name: string
  seedUrl: string
  apiHostRegex: RegExp
  leaguePaths: Array<{ url: string; leagueSlug: string }>
  /** Which proxy tier to route through. Default 'us-mobile' (for CF-gated
   *  US offshore books). Use 'mobile' (CA mobile) for CA-gated books,
   *  'true' for CA residential, or 'false' for direct Railway IP when the
   *  target doesn't geo-gate. */
  useProxy?: 'us-mobile' | 'us' | 'mobile' | true | false
  /** When set, skip the scrape if none of the listed env vars is set.
   *  Default derived from useProxy. */
  requiresEnvVar?: string[]
}

export function buildOffshoreProbeAdapter(cfg: OffshoreProbeConfig): BookAdapter {
  const useProxy = cfg.useProxy ?? 'us-mobile'
  // Default gating: only check env vars for proxy tiers that actually need
  // one. Direct-IP adapters (useProxy: false) always run.
  const requiresEnvVar = cfg.requiresEnvVar ?? (
    useProxy === 'us-mobile' ? ['MOBILE_PROXY_URL_US', 'PROXY_URL_US'] :
    useProxy === 'us'        ? ['PROXY_URL_US']                         :
    useProxy === 'mobile'    ? ['MOBILE_PROXY_URL', 'PROXY_URL']        :
    useProxy === true        ? ['PROXY_URL']                            :
    []
  )

  return {
    slug: cfg.slug,
    name: cfg.name,
    pollIntervalSec: 1800,   // 30 min during discovery — don't burn proxy
    needsBrowser: true,

    async scrape({ signal, log }) {
      if (signal.aborted) return { events: [], errors: ['aborted'] }

      if (requiresEnvVar.length > 0 && !requiresEnvVar.some(v => process.env[v])) {
        log.info(`skipped — set one of [${requiresEnvVar.join(', ')}] on Railway to activate`)
        return { events: [], errors: [] }
      }

      return withPage(async (page) => {
        const scraped: ScrapedEvent[] = []
        const errors: string[] = []
        const seenPaths = new Map<string, number>()
        const sampleBodies = new Map<string, string>()
        // Path → first request body + method we saw. Essential for GraphQL
        // and other POST-bodied APIs: the URL alone doesn't tell us what
        // query / variables the app is asking for.
        const sampleRequests = new Map<string, { method: string; body: string }>()

        // Capture request bodies for API paths. We store only the first
        // one per distinct path + method to cap log volume.
        page.on('request', (req) => {
          const u = req.url()
          if (!cfg.apiHostRegex.test(u)) return
          try {
            const p = new URL(u).pathname
              .replace(/\/[0-9a-f-]{36}/gi, '/:uuid')
              .replace(/\/\d{3,}/g, '/:id')
            const key = `${req.method()} ${p}`
            if (!sampleRequests.has(key) && sampleRequests.size < 20) {
              const body = req.postData() ?? ''
              sampleRequests.set(key, { method: req.method(), body: body.slice(0, 1500) })
            }
          } catch { /* ignore */ }
        })

        // Track distinct hosts seen across ALL responses (not just
        // regex-matched) so when discovery returns distinctPaths=0 we can
        // still see where the page is talking to.
        const allHosts = new Map<string, number>()

        // WebSocket capture. Some exchange apps (Prophet, Fanatics
        // Markets) stream live prices over WS (often Pusher). Log URL +
        // first few frame payloads per connection so we can see if that's
        // where the real data is flowing. Only collect short previews —
        // a live price feed can push thousands of frames per minute.
        const wsFrames: Array<{ url: string; payload: string }> = []
        page.on('websocket', (ws) => {
          const wsUrl = ws.url()
          let framesLogged = 0
          ws.on('framereceived', (data) => {
            if (framesLogged >= 6 || wsFrames.length >= 20) return
            framesLogged++
            const payload = typeof data.payload === 'string'
              ? data.payload
              : Buffer.from(data.payload).toString('utf8')
            wsFrames.push({ url: wsUrl, payload: payload.slice(0, 500) })
          })
        })

        page.on('response', async (resp) => {
          const u = resp.url()
          try {
            const host = new URL(u).host
            allHosts.set(host, (allHosts.get(host) ?? 0) + 1)
          } catch { /* ignore */ }
          if (!cfg.apiHostRegex.test(u)) return
          try {
            const p = new URL(u).pathname
              .replace(/\/[0-9a-f-]{36}/gi, '/:uuid')
              .replace(/\/\d{3,}/g, '/:id')
            seenPaths.set(p, (seenPaths.get(p) ?? 0) + 1)
            if (resp.status() === 200 && !sampleBodies.has(p) && sampleBodies.size < 8) {
              try { sampleBodies.set(p, (await resp.text()).slice(0, 2000)) } catch { /* body closed */ }
            }
          } catch { /* ignore */ }
        })

        log.info('seeding offshore session', { url: cfg.seedUrl })
        let seedStatus = 0
        try {
          const resp = await page.goto(cfg.seedUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 })
          seedStatus = resp?.status() ?? 0
          await page.waitForTimeout(3_500)
        } catch (e: any) {
          // Loud error log — the earlier adapters (powerplay, miseojeu)
          // returned silently in <400ms because this went to errors[] only.
          // Surface the exact Playwright message so we can debug.
          const message = e?.message ?? String(e)
          log.error('seed failed', { url: cfg.seedUrl, message })
          errors.push(`seed: ${message}`)
          return { events: scraped, errors }
        }

        if (seedStatus === 403 || seedStatus === 503) {
          log.warn('CF blocked landing page — escalate to MOBILE_PROXY_URL_US', { status: seedStatus })
          errors.push(`landing: HTTP ${seedStatus}`)
          return { events: scraped, errors }
        }

        for (const lg of cfg.leaguePaths) {
          if (signal.aborted) break
          try {
            await page.goto(lg.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            await page.waitForTimeout(3_000)
          } catch (e: any) {
            const message = e?.message ?? String(e)
            log.warn('league nav failed', { league: lg.leagueSlug, url: lg.url, message })
            errors.push(`${lg.leagueSlug} nav: ${message}`)
          }
        }

        log.info('offshore discovery', {
          distinctPaths: seenPaths.size,
          topPaths: [...seenPaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15),
          sampleCount: sampleBodies.size,
          requestSampleCount: sampleRequests.size,
          // Distinct response hosts regardless of regex match — tells us
          // where the SPA actually talks to if our regex misses it.
          allHosts: [...allHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
          wsFrameCount: wsFrames.length,
        })
        for (const f of wsFrames) {
          log.info('offshore ws frame', {
            url: f.url.slice(0, 120),
            len: f.payload.length,
            preview: f.payload,
          })
        }
        for (const [path, body] of sampleBodies) {
          log.info('offshore sample body', { path, len: body.length, preview: body.slice(0, 400) })
        }
        // Log captured request bodies — especially important for GraphQL
        // endpoints like Novig's /v1/graphql where the query is in the body.
        for (const [key, { method, body }] of sampleRequests) {
          if (!body) continue
          log.info('offshore sample request', { key, method, bodyLen: body.length, preview: body.slice(0, 600) })
        }

        return { events: scraped, errors }
      }, { useProxy, rotateSession: true })
    },
  }
}
