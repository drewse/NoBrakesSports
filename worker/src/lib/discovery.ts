import type { Page } from 'playwright'
import type { Logger } from './logger.js'

export interface CapturedXhr {
  url: string
  status: number
  bodyLen: number
  topKeys: string[]
  sample: string
  contentType: string
}

/** Attach response+request listeners that capture every JSON-ish api XHR.
 *  Returns two things: the captured-xhrs array (mutated as responses stream in)
 *  and a detach() to remove the listeners.
 *
 *  Use this in new-book discovery adapters: navigate to a seed URL with the
 *  listener active, then dump `captured` to logs to see which URL carries
 *  events. Once you identify it, replace the listener-based capture with
 *  targeted parsing. */
export function attachXhrCapture(
  page: Page,
  log: Logger,
  opts: {
    hostIncludes: string[]          // only capture URLs whose host matches
    bookSlug: string
    maxBodyBytes?: number           // default 200 — only stash a snippet
    includePath?: RegExp            // optional narrower filter on pathname
    excludePath?: RegExp            // optional skip filter
  },
): { captured: CapturedXhr[]; detach: () => void } {
  const captured: CapturedXhr[] = []
  const maxBody = opts.maxBodyBytes ?? 200

  const handler = async (resp: import('playwright').Response) => {
    const url = resp.url()
    if (!opts.hostIncludes.some((h) => url.includes(h))) return
    if (opts.includePath && !opts.includePath.test(url)) return
    if (opts.excludePath && opts.excludePath.test(url)) return
    const ct = (resp.headers()['content-type'] ?? '').toLowerCase()
    // Only care about JSON responses for discovery; skip images/css/html
    if (!ct.includes('json') && !ct.includes('javascript')) return

    let text = ''
    try { text = await resp.text() } catch { /* stream closed */ }
    let topKeys: string[] = []
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) topKeys = [`__array__len=${parsed.length}`]
      else if (parsed && typeof parsed === 'object') topKeys = Object.keys(parsed).slice(0, 20)
    } catch { /* non-JSON, leave empty */ }

    captured.push({
      url: url.length > 200 ? url.slice(0, 200) + '...' : url,
      status: resp.status(),
      bodyLen: text.length,
      topKeys,
      sample: text.slice(0, maxBody),
      contentType: ct,
    })
  }
  page.on('response', handler)
  return {
    captured,
    detach: () => page.off('response', handler),
  }
}

/** Log a summary of captured XHRs — grouped by path prefix for readability. */
export function logXhrSummary(log: Logger, bookSlug: string, captured: CapturedXhr[]) {
  // Group by rough path shape to keep logs readable even when the SPA fires
  // hundreds of XHRs. Replace UUIDs/numeric ids with ":id".
  const groups = new Map<string, { count: number; statuses: Set<number>; sampleUrl: string; biggestBody: number; biggestSample: string; biggestKeys: string[] }>()
  for (const x of captured) {
    let path: string
    try { path = new URL(x.url.replace(/\.\.\.$/, '')).pathname } catch { path = x.url }
    const shape = path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
      .replace(/\/\d{3,}/g, '/:id')
    const g = groups.get(shape) ?? { count: 0, statuses: new Set<number>(), sampleUrl: x.url, biggestBody: 0, biggestSample: '', biggestKeys: [] }
    g.count++
    g.statuses.add(x.status)
    if (x.bodyLen > g.biggestBody) {
      g.biggestBody = x.bodyLen
      g.biggestSample = x.sample
      g.biggestKeys = x.topKeys
    }
    groups.set(shape, g)
  }
  const summary = Array.from(groups.entries())
    .sort((a, b) => b[1].biggestBody - a[1].biggestBody)
    .slice(0, 40)
    .map(([shape, g]) => ({
      path: shape,
      count: g.count,
      statuses: Array.from(g.statuses),
      biggestBytes: g.biggestBody,
      topKeys: g.biggestKeys,
      sampleUrl: g.sampleUrl,
      sample: g.biggestSample,
    }))
  log.info('xhr discovery summary', { book: bookSlug, totalXhrs: captured.length, uniquePaths: groups.size, summary })
}
