import { createLogger, type Logger } from './logger.js'
import { writeBookResults } from './writer.js'
import { currentAdapter } from './browser.js'
import type { RunContext, ScrapeResult } from './types.js'

/** Contract every book adapter implements. */
export interface BookAdapter {
  slug: string              // DB market_sources.slug (e.g. 'pointsbet_on')
  name: string              // Display name (e.g. 'PointsBet (Ontario)')
  pollIntervalSec: number   // How often to re-scrape (seconds)
  needsBrowser: boolean     // If true, adapter uses Playwright (heavier)

  scrape(ctx: RunContext): Promise<ScrapeResult>
}

interface RunnerState {
  adapter: BookAdapter
  log: Logger
  timer: NodeJS.Timeout | null
  running: boolean
  lastRunAt: number | null
  lastSuccessAt: number | null
  lastError: string | null
  consecutiveFailures: number
  currentCtrl: AbortController | null
}

const runners = new Map<string, RunnerState>()

/** Kick off a forever-loop for each adapter. Crashes in one adapter do not
 *  affect the others. Returns a shutdown() function. */
export function startScheduler(adapters: BookAdapter[]): () => Promise<void> {
  // Wall-clock aligned scheduling. Each adapter fires on UTC ticks that
  // are multiples of pollIntervalSec from the epoch — e.g. a 2h adapter
  // runs at 00:00, 02:00, 04:00… UTC every day. A Railway redeploy at
  // 02:30 doesn't trigger a scrape; the next one still lands at 04:00.
  // This eliminates deploy-driven proxy burn while keeping the schedule
  // predictable. Stagger browser adapters on first boot so N of them
  // don't race to newContext() on the same millisecond.
  let browserIdx = 0
  for (const adapter of adapters) {
    const state: RunnerState = {
      adapter,
      log: createLogger(adapter.slug),
      timer: null,
      running: false,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      currentCtrl: null,
    }
    runners.set(adapter.slug, state)
    const stagger = adapter.needsBrowser ? (browserIdx++ * 4_000) : 0
    scheduleAligned(state, stagger)
  }

  return async () => {
    for (const state of runners.values()) {
      if (state.timer) clearTimeout(state.timer)
      if (state.currentCtrl) state.currentCtrl.abort()
    }
  }
}

function scheduleNext(state: RunnerState, delayMs: number): void {
  state.timer = setTimeout(() => runOnce(state), delayMs)
}

/** Schedule the next run on the next wall-clock tick that is a multiple
 *  of pollIntervalSec from the Unix epoch (UTC). Used on boot and after
 *  successful runs so the schedule stays stable across redeploys. */
function scheduleAligned(state: RunnerState, extraDelay = 0): void {
  const pollMs = state.adapter.pollIntervalSec * 1000
  const now = Date.now()
  const nextTick = Math.ceil(now / pollMs) * pollMs
  let delay = (nextTick - now) + extraDelay
  // If we're essentially at the tick already (< 500ms), skip to the next
  // one so we don't double-fire after a just-finished scrape.
  if (delay < 500) delay += pollMs
  scheduleNext(state, delay)
}

async function runOnce(state: RunnerState): Promise<void> {
  if (state.running) return
  state.running = true
  state.lastRunAt = Date.now()
  const ctrl = new AbortController()
  state.currentCtrl = ctrl

  // Hard-timeout each scrape at 2x the poll interval to protect against hangs
  const timeoutMs = state.adapter.pollIntervalSec * 2 * 1000
  const timeoutHandle = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    state.log.debug('scrape start')
    const start = Date.now()
    const result = await currentAdapter.run(
      { slug: state.adapter.slug },
      () => state.adapter.scrape({ signal: ctrl.signal, log: state.log }),
    )

    await writeBookResults(
      { sourceSlug: state.adapter.slug, sourceName: state.adapter.name },
      result.events
    )

    const durMs = Date.now() - start
    state.lastSuccessAt = Date.now()
    state.lastError = null
    state.consecutiveFailures = 0
    state.log.info('scrape ok', {
      events: result.events.length,
      durMs,
      adapterErrors: result.errors.length,
    })
    if (result.errors.length > 0) {
      for (const err of result.errors.slice(0, 12)) {
        state.log.error('adapter error', { message: err })
      }
    }
  } catch (err: any) {
    state.lastError = err?.message ?? String(err)
    state.consecutiveFailures += 1
    state.log.error('scrape failed', {
      message: state.lastError,
      consecutiveFailures: state.consecutiveFailures,
    })
  } finally {
    clearTimeout(timeoutHandle)
    state.currentCtrl = null
    state.running = false

    if (state.consecutiveFailures > 0) {
      // On failure, back off from "now" rather than aligning — a broken
      // adapter shouldn't keep slamming the exact aligned tick.
      const base = state.adapter.pollIntervalSec * 1000
      const backoffMult = Math.min(10, Math.pow(2, state.consecutiveFailures))
      scheduleNext(state, base * backoffMult)
    } else {
      scheduleAligned(state)
    }
  }
}

export function getRunnerStatus(): Array<{
  slug: string
  name: string
  pollIntervalSec: number
  running: boolean
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  consecutiveFailures: number
}> {
  return [...runners.values()].map(s => ({
    slug: s.adapter.slug,
    name: s.adapter.name,
    pollIntervalSec: s.adapter.pollIntervalSec,
    running: s.running,
    lastRunAt: s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    lastError: s.lastError,
    consecutiveFailures: s.consecutiveFailures,
  }))
}
