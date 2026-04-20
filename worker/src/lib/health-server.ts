import express from 'express'
import { getRunnerStatus } from './adapter.js'
import { createLogger } from './logger.js'

const log = createLogger('health')

export function startHealthServer(port: number): { close: () => void } {
  const app = express()

  app.get('/health', (_req, res) => {
    const runners = getRunnerStatus()
    const now = Date.now()

    // Healthy if every runner has a success in the last 15 minutes
    // OR has run fewer than 3 times (cold start grace)
    const unhealthy = runners.filter(r => {
      if (!r.lastSuccessAt) return r.consecutiveFailures >= 3
      const age = now - Date.parse(r.lastSuccessAt)
      return age > 15 * 60 * 1000
    })

    const status = unhealthy.length === 0 ? 'ok' : 'degraded'
    res.status(unhealthy.length === 0 ? 200 : 503).json({
      status,
      runners,
      unhealthyCount: unhealthy.length,
      ts: new Date().toISOString(),
    })
  })

  app.get('/', (_req, res) => {
    res.json({ service: 'nobrakes-worker', status: 'running' })
  })

  const server = app.listen(port, () => {
    log.info(`listening on :${port}`)
  })

  return { close: () => server.close() }
}
