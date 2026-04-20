import { createLogger } from './lib/logger.js'
import { startScheduler, type BookAdapter } from './lib/adapter.js'
import { startHealthServer } from './lib/health-server.js'
import { shutdownBrowser } from './lib/browser.js'
import { getSupabase } from './lib/supabase.js'

// Registered adapters. Add more here as you port/build them.
import { pointsbetAdapter } from './adapters/pointsbet.js'
import { pinnacleAdapter } from './adapters/pinnacle.js'

const ALL_ADAPTERS: BookAdapter[] = [
  pointsbetAdapter,
  pinnacleAdapter,
  // Add more here:
  // bet365Adapter,
  // caesarsAdapter,
]

const log = createLogger('main')

async function main() {
  // Validate env
  getSupabase() // throws if env missing

  // Filter by ENABLED_BOOKS if set
  const enabledSet = process.env.ENABLED_BOOKS
    ? new Set(process.env.ENABLED_BOOKS.split(',').map(s => s.trim()).filter(Boolean))
    : null
  const adapters = enabledSet
    ? ALL_ADAPTERS.filter(a => enabledSet.has(a.slug))
    : ALL_ADAPTERS

  if (adapters.length === 0) {
    log.error('no adapters enabled — exiting')
    process.exit(1)
  }

  log.info('starting worker', {
    adapters: adapters.map(a => a.slug),
    node: process.version,
    build: 'v2-writer-verbose',
  })

  // Start health server so Railway's probe passes
  const port = parseInt(process.env.PORT ?? '8080', 10)
  const health = startHealthServer(port)

  // Start the scheduler (kicks off each adapter)
  const stopScheduler = startScheduler(adapters)

  // Graceful shutdown
  async function shutdown(signal: string) {
    log.info('shutdown received', { signal })
    try { await stopScheduler() } catch { /* ignore */ }
    try { await shutdownBrowser() } catch { /* ignore */ }
    try { health.close() } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 2_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))

  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { reason: String(reason) })
  })
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', { message: err.message, stack: err.stack })
  })
}

main().catch(err => {
  console.error('fatal error during boot:', err)
  process.exit(1)
})
