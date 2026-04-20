import { createLogger, type Logger } from './logger.js'
import { writeBookResults } from './writer.js'
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
    scheduleNext(state, 1_000)  // first run shortly after boot
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
    const result = await state.adapter.scrape({ signal: ctrl.signal, log: state.log })

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

    // Backoff on repeated failures: double the poll interval, cap at 10 min
    const base = state.adapter.pollIntervalSec * 1000
    const backoffMult = Math.min(10, Math.pow(2, state.consecutiveFailures))
    scheduleNext(state, base * backoffMult)
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
