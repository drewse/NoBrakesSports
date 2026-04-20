import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { createLogger } from './logger.js'

const log = createLogger('browser')

let _browser: Browser | null = null

/** Lazily-started shared Chromium. One process-wide instance; each adapter
 *  opens its own isolated BrowserContext so cookies/sessions don't leak. */
export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser
  log.info('launching chromium')
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  })
  _browser.on('disconnected', () => {
    log.warn('chromium disconnected')
    _browser = null
  })
  return _browser
}

export async function shutdownBrowser(): Promise<void> {
  if (_browser) {
    log.info('shutting down chromium')
    await _browser.close().catch(() => { /* ignore */ })
    _browser = null
  }
}

/** Open an isolated context with sane anti-bot defaults. Caller must close it. */
export async function openContext(opts: {
  userAgent?: string
  viewport?: { width: number; height: number }
  extraHeaders?: Record<string, string>
} = {}): Promise<BrowserContext> {
  const browser = await getBrowser()
  return browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    userAgent: opts.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Toronto',
    extraHTTPHeaders: opts.extraHeaders,
    bypassCSP: true,
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
