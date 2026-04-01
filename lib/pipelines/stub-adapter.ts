import type { SourceAdapter, HealthCheckResult } from './types'

// ── NotImplementedError ───────────────────────────────────────────────────────

/**
 * Thrown by stub adapters when a method has not been implemented yet.
 * The pipeline runner catches this specifically and logs it as
 * error_type = 'not_implemented' without crashing the app.
 */
export class NotImplementedError extends Error {
  readonly slug: string
  readonly method: string

  constructor(slug: string, method: string) {
    super(`[${slug}] ${method} is not yet implemented`)
    this.name = 'NotImplementedError'
    this.slug = slug
    this.method = method
  }
}

// ── createStubAdapter ─────────────────────────────────────────────────────────

/**
 * Returns a SourceAdapter where:
 * - fetchEvents  → throws NotImplementedError (caught by runner, never crashes app)
 * - fetchMarkets → throws NotImplementedError
 * - healthCheck  → always resolves with { healthy: false, message: "not implemented" }
 *
 * Usage:
 *   const adapter = createStubAdapter('fanduel')
 *   await adapter.healthCheck()
 *   // → { healthy: false, message: 'fanduel: adapter not yet implemented' }
 */
export function createStubAdapter(slug: string): SourceAdapter {
  return {
    slug,

    async fetchEvents(_options?: Record<string, unknown>) {
      throw new NotImplementedError(slug, 'fetchEvents')
    },

    async fetchMarkets(_eventId: string, _options?: Record<string, unknown>) {
      throw new NotImplementedError(slug, 'fetchMarkets')
    },

    async healthCheck(): Promise<HealthCheckResult> {
      // Stubs never throw — healthCheck always resolves so the runner
      // can record the "not implemented" state without error escalation.
      return {
        healthy: false,
        message: `${slug}: adapter not yet implemented`,
      }
    },
  }
}
