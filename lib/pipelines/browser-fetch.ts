// ─────────────────────────────────────────────────────────────────────────────
// Browser-based fetch utility using Playwright + Chromium
//
// Uses real Chromium so requests have a genuine browser TLS fingerprint and
// Cloudflare Bot Management cookies — bypasses CF protection that blocks
// Node.js/undici fetch calls.
//
// On Vercel: uses @sparticuz/chromium (serverless-compatible binary)
// Locally:   uses whatever Playwright browser is installed
// ─────────────────────────────────────────────────────────────────────────────

import { chromium as playwright } from 'playwright-core'
import type { Page } from 'playwright-core'

// ── Browser launcher ──────────────────────────────────────────────────────────

async function launchBrowser() {
  const isVercel = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_VERSION

  if (isVercel) {
    // Serverless: use @sparticuz/chromium binary
    const chromium = (await import('@sparticuz/chromium')).default
    return playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  // Local: use Playwright's installed browser
  return playwright.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
}

// ── Context helper ─────────────────────────────────────────────────────────────

export interface BrowserSession {
  /**
   * Navigate to a URL. Waits for network to go idle so Cloudflare cookies are set.
   */
  visit(url: string): Promise<void>
  /**
   * Fetch a JSON API endpoint from within the browser context.
   * Uses browser's real TLS + cookies — bypasses Cloudflare.
   */
  fetchJson(url: string, headers?: Record<string, string>): Promise<any>
  /**
   * Access the raw Playwright page if needed.
   */
  page: Page
}

/**
 * Opens a Chromium browser, runs `fn` with a BrowserSession, then closes.
 * All requests made inside `fn` use a real browser TLS fingerprint.
 *
 * @example
 * const data = await withBrowser(async ({ visit, fetchJson }) => {
 *   await visit('https://on.pointsbet.ca')  // sets CF cookies
 *   return fetchJson('https://api.on.pointsbet.com/api/v2/sports/basketball/competitions')
 * })
 */
export async function withBrowser<T>(fn: (session: BrowserSession) => Promise<T>): Promise<T> {
  const browser = await launchBrowser()

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-CA',
      timezoneId: 'America/Toronto',
      viewport: { width: 1280, height: 800 },
    })

    const page = await context.newPage()

    const session: BrowserSession = {
      page,

      async visit(url: string) {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        // Brief pause for Cloudflare to set cookies
        await page.waitForTimeout(2_000)
      },

      async fetchJson(url: string, headers?: Record<string, string>) {
        return page.evaluate(
          async ({ url, headers }) => {
            const res = await fetch(url, {
              headers: {
                Accept: 'application/json',
                ...headers,
              },
              credentials: 'include',
            })
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
            return res.json()
          },
          { url, headers: headers ?? {} }
        )
      },
    }

    return await fn(session)
  } finally {
    await browser.close()
  }
}
