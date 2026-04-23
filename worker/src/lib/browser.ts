import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createLogger } from './logger.js'
import { getSupabase } from './supabase.js'

const log = createLogger('browser')

// Threaded through scrape() so openContext can tag bandwidth rows with the
// right adapter slug without every adapter having to plumb it in.
export const currentAdapter = new AsyncLocalStorage<{ slug: string }>()

function proxyTierOf(useProxy: unknown): string | null {
  if (useProxy === 'mobile') return 'mobile'
  if (useProxy === 'us-mobile') return 'us-mobile'
  if (useProxy === 'us') return 'us-residential'
  if (useProxy === true) return 'residential'
  return null
}

async function writeProxyUsage(row: { adapter_slug: string; proxy_tier: string; bytes: number; scrape_ms: number }) {
  try {
    const db = getSupabase()
    const { error } = await db.from('proxy_usage_log').insert(row)
    if (error) log.warn('proxy_usage_log insert failed', { message: error.message, code: error.code })
  } catch (err: any) {
    log.warn('proxy_usage_log write threw', { message: err?.message ?? String(err) })
  }
}

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
 *  Pass `rotateSession: true` to force a fresh sticky-session ID on this
 *  context — required for IPRoyal because their sticky sessions expire
 *  after `lifetime-<N>m` and re-using an expired session ID gets
 *  ERR_TUNNEL_CONNECTION_FAILED. Every context gets a new short ID so we
 *  always land on a fresh 30-min sticky exit. (PacketStream legacy: port
 *  31112 sticky / 31113 rotating — preserved as a fallback.) */
function randomSessionId(): string {
  // 8-char alphanumeric — matches IPRoyal's session token shape.
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

export async function openContext(opts: {
  userAgent?: string
  viewport?: { width: number; height: number }
  extraHeaders?: Record<string, string>
  useProxy?: boolean | 'mobile' | 'us-mobile' | 'us'
  rotateSession?: boolean
  ignoreHTTPSErrors?: boolean
  /** Block images / fonts / media / stylesheets at the route layer. Default
   *  true when a proxy is used — sportsbook SPAs ship 8-10 MB of static
   *  assets per page, and mobile proxy bandwidth is expensive. Set false if
   *  a site's bot-check reads image load events (rare). */
  blockResources?: boolean
} = {}): Promise<BrowserContext> {
  const browser = await getBrowser()
  // Proxy tiers:
  //   useProxy: true        -> PROXY_URL             (CA residential, e.g. PacketStream)
  //   useProxy: 'mobile'    -> MOBILE_PROXY_URL      (CA mobile, e.g. IPRoyal)
  //   useProxy: 'us'        -> PROXY_URL_US          (US residential)
  //   useProxy: 'us-mobile' -> MOBILE_PROXY_URL_US   (US mobile — required for
  //                                                   US sportsbooks behind CF)
  //   useProxy: false       -> direct Railway IP     (free)
  // Adapters choose based on what the target site's WAF accepts.
  let proxyUrl: string | undefined
  if (opts.useProxy === 'us-mobile') {
    proxyUrl = process.env.MOBILE_PROXY_URL_US || process.env.PROXY_URL_US
    if (!process.env.MOBILE_PROXY_URL_US && process.env.PROXY_URL_US) {
      log.warn('us-mobile requested but MOBILE_PROXY_URL_US unset — falling back to PROXY_URL_US')
    }
  } else if (opts.useProxy === 'us') {
    proxyUrl = process.env.PROXY_URL_US
  } else if (opts.useProxy === 'mobile') {
    proxyUrl = process.env.MOBILE_PROXY_URL || process.env.PROXY_URL
    if (!process.env.MOBILE_PROXY_URL && process.env.PROXY_URL) {
      log.warn('mobile proxy requested but MOBILE_PROXY_URL unset — falling back to PROXY_URL')
    }
  } else if (opts.useProxy === true) {
    proxyUrl = process.env.PROXY_URL
  }
  let proxy: { server: string; username?: string; password?: string } | undefined
  if (proxyUrl) {
    try {
      const u = new URL(proxyUrl)
      let host = u.host
      let password = u.password
      // PacketStream legacy: sticky=31112, rotating=31113.
      if (opts.rotateSession && u.port === '31112') {
        host = `${u.hostname}:31113`
      }
      // IPRoyal: session encoded in password as `_session-<id>_lifetime-..`.
      // Swap the session ID to a fresh random one per context so we don't
      // reuse expired stickies across cycles.
      if (password && /_session-[^_]+/.test(password)) {
        password = password.replace(/_session-[^_]+/, `_session-${randomSessionId()}`)
      }
      proxy = {
        server: `${u.protocol}//${host}`,
        username: u.username || undefined,
        password: password || undefined,
      }
    } catch {
      log.warn('proxy URL invalid — falling back to direct', { tier: opts.useProxy })
    }
  }
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 1440, height: 900 },
    userAgent: opts.userAgent ?? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Toronto',
    extraHTTPHeaders: opts.extraHeaders,
    bypassCSP: true,
    ignoreHTTPSErrors: opts.ignoreHTTPSErrors ?? false,
    ...(proxy ? { proxy } : {}),
  })

  // Resource blocking: abort images/fonts/media/stylesheets so mobile proxy
  // bandwidth is spent only on HTML + JS + XHR. Default on when any proxy
  // tier is active — raw Railway IP scrapes are free so save the overhead.
  const shouldBlock = opts.blockResources ?? !!proxy
  if (shouldBlock) {
    await context.route('**/*', (route) => {
      const t = route.request().resourceType()
      if (t === 'image' || t === 'font' || t === 'media' || t === 'stylesheet') {
        return route.abort()
      }
      return route.continue()
    })
  }

  // Bandwidth accounting. Every response body length is summed per context;
  // when the context closes we flush one row per (adapter × proxy tier).
  // Only instruments proxied contexts — raw Railway IP is free.
  const tier = proxyTierOf(opts.useProxy)
  if (tier && proxy) {
    const adapter = currentAdapter.getStore()?.slug ?? 'unknown'
    const startedAt = Date.now()
    let bytes = 0
    context.on('response', (resp) => {
      // Fire-and-forget body fetch: Playwright has already buffered the
      // body, so this is a cheap copy. Skip errors (304, cross-origin
      // redirect, aborted, etc.) — they contribute negligible bytes.
      resp.body().then((b) => { bytes += b.byteLength }).catch(() => { /* ignore */ })
    })
    context.once('close', () => {
      // Allow in-flight body() promises to settle before we read bytes.
      setTimeout(() => {
        void writeProxyUsage({
          adapter_slug: adapter,
          proxy_tier: tier,
          bytes,
          scrape_ms: Date.now() - startedAt,
        })
      }, 250)
    })
  }

  return context
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
