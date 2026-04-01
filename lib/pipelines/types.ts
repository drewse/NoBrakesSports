// ─────────────────────────────────────────────────────────────────────────────
// Pipeline core types
// All ingestion logic is scaffolded but not implemented.
// Adapters throw NotImplementedError until live integration is built.
// ─────────────────────────────────────────────────────────────────────────────

// ── Adapter contract ──────────────────────────────────────────────────────────

export interface FetchEventsResult {
  /** Verbatim raw payload returned by the source — stored for replay/debugging. */
  raw: unknown
  /** Loosely typed event objects before canonical normalization. */
  events: unknown[]
}

export interface FetchMarketsResult {
  /** Verbatim raw payload returned by the source. */
  raw: unknown
  /** Loosely typed market objects before canonical normalization. */
  markets: unknown[]
}

export interface HealthCheckResult {
  healthy: boolean
  latencyMs?: number
  message?: string
}

export interface SourceAdapter {
  /** Unique identifier matching data_pipelines.slug */
  slug: string
  /** Fetch the list of upcoming events for this source. */
  fetchEvents(options?: Record<string, unknown>): Promise<FetchEventsResult>
  /** Fetch markets for a specific event by its source-side ID. */
  fetchMarkets(eventId: string, options?: Record<string, unknown>): Promise<FetchMarketsResult>
  /** Lightweight connectivity / auth check. Must never throw — always resolves. */
  healthCheck(): Promise<HealthCheckResult>
}

// ── Pipeline run records ──────────────────────────────────────────────────────

export type PipelineRunStatus = 'running' | 'success' | 'failed' | 'skipped'

export interface PipelineRunRecord {
  id: string
  pipeline_slug: string
  started_at: string
  finished_at: string | null
  status: PipelineRunStatus
  events_fetched: number
  markets_fetched: number
  error_count: number
  notes: string | null
  created_at: string
}

export type PipelineErrorType = 'not_implemented' | 'network' | 'parse' | 'auth' | 'unknown'

export interface PipelineErrorRecord {
  id: string
  pipeline_slug: string
  run_id: string | null
  error_type: PipelineErrorType
  error_message: string
  error_stack: string | null
  context: Record<string, unknown> | null
  created_at: string
}

// ── Raw payload storage ───────────────────────────────────────────────────────

export type RawPayloadType = 'events' | 'markets' | 'health' | 'other'

export interface RawSourcePayload {
  id: string
  pipeline_slug: string
  run_id: string | null
  payload_type: RawPayloadType
  payload: unknown
  byte_size: number
  captured_at: string
}

// ── Canonical normalized types ────────────────────────────────────────────────

export type CanonicalMarketShape = '2way' | '3way'

export type CanonicalOutcomeSide = 'home' | 'away' | 'draw' | 'over' | 'under'

export interface CanonicalOutcome {
  side: CanonicalOutcomeSide
  label: string
  /** American odds integer (e.g. -110, +150) */
  price: number
  /** Implied probability 0–1 derived from the raw price before devig */
  impliedProb: number
}

export interface CanonicalMarket {
  eventId: string
  marketType: 'moneyline' | 'spread' | 'total'
  shape: CanonicalMarketShape
  outcomes: CanonicalOutcome[]
  /** Spread value or total line; null for moneyline */
  lineValue: number | null
  sourceSlug: string
  capturedAt: string
}

export type CanonicalEventStatus = 'scheduled' | 'live' | 'final' | 'cancelled'

export interface CanonicalEvent {
  /** Source-side unique identifier */
  externalId: string
  /** "Home Team vs Away Team" format */
  title: string
  homeTeam: string
  awayTeam: string
  /** ISO 8601 UTC */
  startTime: string
  leagueSlug: string
  sourceSlug: string
  status: CanonicalEventStatus
}

// ── Pipeline data record (mirrors data_pipelines table) ───────────────────────

export interface PipelineRecord {
  id: string
  slug: string
  display_name: string
  source_type: string
  region: string
  is_enabled: boolean
  status: 'planned' | 'inactive' | 'healthy' | 'warning' | 'error'
  priority: number
  ingestion_method: string | null
  health_status: 'unknown' | 'healthy' | 'degraded' | 'down'
  notes: string | null
  last_checked_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}
