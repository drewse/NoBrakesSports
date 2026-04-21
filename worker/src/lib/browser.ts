import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createLogger } from './logger.js'

const log = createLogger('browser')

let _browser: Browser | null = null
let _launching: Promise<Browser> | null = null

/** Lazily-started shared Chromium. One process-wide instance; each adapter
 *  opens its own isolated BrowserContext so cookies/sessions don't leak.
 *
 *  Concurrent callers share a single launch — otherwise the scheduler's
 *  simultaneous boot fires N chromium.launch() calls, some of which
 *  immediately disconnect each other and leave in-flight newContext()
 *  calls with "Target page, context or browser has been closed". */
export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser
  if (_launching) return _launching
  _launching = (async () => {
    log.info('launching chromium')
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    })
    browser.on('disconnected', () => {
      log.warn('chromium disconnected')
      _browser = null
    })
    _browser = browser
    return browser
  })()
  try {
    return await _launching
  } finally {
    _launching = null
  }
}

export async function shutdownBrowser(): Promise<void> {
  if (_browser) {
    log.info('shutting down chromium')
    await _browser.close().catch(() => { /* ignore */ })
    _browser = null
  }
}

/** Open an isolated context with sane anti-bot defaults. Caller must close it.
 *  Pass `useProxy: true` to route this context through PROXY_URL (residential
 *  proxy, required for sites that hard-block the Railway IP via CF).
 *  Pass `rotateSession: true` to route through the provider's rotating
 *  (per-request exit IP) pool instead of the sticky pool. PacketStream uses
 *  port 31112 for sticky, 31113 for rotating — we rewrite the port. */
export async function openContext(opts: {
  userAgent?: string
  viewport?: { width: number; height: number }
  extraHeaders?: Record<string, string>
  useProxy?: boolean
  rotateSession?: boolean
} = {}): Promise<BrowserContext> {
  const browser = await getBrowser()
  let proxy: { server: string; username?: string; password?: string } | undefined
  if (opts.useProxy && process.env.PROXY_URL) {
    try {
      const u = new URL(process.env.PROXY_URL)
      let host = u.host
      // PacketStream: sticky=31112, rotating=31113. If caller asked for
      // rotation and URL points at the sticky port, swap to rotating.
      if (opts.rotateSession && u.port === '31112') {
        host = `${u.hostname}:31113`
      }
      proxy = {
        server: `${u.protocol}//${host}`,
        username: u.username || undefined,
        password: u.password || undefined,
      }
    } catch {
      log.warn('PROXY_URL invalid — falling back to direct')
    }
  }
  return browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    userAgent: opts.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Toronto',
    extraHTTPHeaders: opts.extraHeaders,
    bypassCSP: true,
    ...(proxy ? { proxy } : {}),
  })
}

/** Convenience: run a function with a fresh context/page and auto-close. */
export async function withPage<T>(
  fn: (page: Page, ctx: BrowserContext) => Promise<T>,
  opts?: Parameters<typeof openContext>[0]
): Promise<T> {
  const ctx = await openContext(opts)
  try {
    const page = await ctx.newPage()
    return await fn(page, ctx)
  } finally {
    await ctx.close().catch(() => { /* ignore */ })
  }
}
