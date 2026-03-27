// ============================================================
// NO BRAKES SPORTS — Core Types
// ============================================================

export type SubscriptionStatus =
  | 'active'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'past_due'
  | 'paused'
  | 'trialing'
  | 'unpaid'

export type SubscriptionTier = 'free' | 'pro'

export type MarketType = 'moneyline' | 'spread' | 'total' | 'prop' | 'futures' | 'prediction'

export type AlertType = 'line_movement' | 'price_change' | 'source_divergence' | 'event_start'

export type AlertStatus = 'active' | 'triggered' | 'paused' | 'deleted'

export type MovementDirection = 'up' | 'down' | 'flat'

export type EventStatus = 'scheduled' | 'live' | 'completed' | 'postponed' | 'canceled'

export type SourceType = 'sportsbook' | 'prediction_market' | 'exchange'

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

// ============================================================
// DATABASE ROW TYPES
// ============================================================

export interface Profile {
  id: string
  email: string
  full_name: string | null
  avatar_url: string | null
  username: string | null
  bio: string | null
  timezone: string
  stripe_customer_id: string | null
  subscription_id: string | null
  subscription_status: SubscriptionStatus
  subscription_tier: SubscriptionTier
  subscription_period_end: string | null
  trial_end: string | null
  onboarding_completed: boolean
  favorite_sports: string[]
  favorite_leagues: string[]
  is_admin: boolean
  created_at: string
  updated_at: string
}

export interface Sport {
  id: string
  name: string
  slug: string
  icon_url: string | null
  display_order: number
  is_active: boolean
  created_at: string
}

export interface League {
  id: string
  sport_id: string
  name: string
  slug: string
  abbreviation: string | null
  country: string | null
  logo_url: string | null
  display_order: number
  is_active: boolean
  is_premium: boolean
  created_at: string
  sport?: Sport
}

export interface Team {
  id: string
  league_id: string
  name: string
  slug: string
  abbreviation: string | null
  city: string | null
  logo_url: string | null
  primary_color: string | null
  secondary_color: string | null
  is_active: boolean
  created_at: string
  league?: League
}

export interface Event {
  id: string
  league_id: string
  home_team_id: string | null
  away_team_id: string | null
  title: string
  description: string | null
  start_time: string
  end_time: string | null
  status: EventStatus
  home_score: number | null
  away_score: number | null
  external_id: string | null
  source_metadata: Record<string, unknown>
  is_featured: boolean
  created_at: string
  updated_at: string
  league?: League
  home_team?: Team
  away_team?: Team
}

export interface MarketSource {
  id: string
  name: string
  slug: string
  source_type: SourceType
  logo_url: string | null
  website_url: string | null
  api_endpoint: string | null
  is_active: boolean
  health_status: HealthStatus
  last_health_check: string | null
  display_order: number
  created_at: string
  updated_at: string
}

export interface MarketSnapshot {
  id: string
  event_id: string
  source_id: string
  market_type: MarketType
  home_price: number | null
  away_price: number | null
  draw_price: number | null
  spread_value: number | null
  total_value: number | null
  over_price: number | null
  under_price: number | null
  home_implied_prob: number | null
  away_implied_prob: number | null
  movement_direction: MovementDirection
  movement_magnitude: number
  is_open: boolean
  raw_data: Record<string, unknown>
  snapshot_time: string
  created_at: string
  event?: Event
  source?: MarketSource
}

export interface PredictionMarketSnapshot {
  id: string
  event_id: string | null
  source_id: string
  contract_title: string
  external_contract_id: string | null
  yes_price: number | null
  no_price: number | null
  yes_volume: number | null
  no_volume: number | null
  total_volume: number | null
  open_interest: number | null
  sportsbook_source_id: string | null
  sportsbook_implied_prob: number | null
  divergence_pct: number | null
  prev_yes_price: number | null
  price_change_24h: number | null
  is_resolved: boolean
  resolution_value: boolean | null
  snapshot_time: string
  created_at: string
  event?: Event
  source?: MarketSource
  sportsbook_source?: MarketSource
}

export interface Watchlist {
  id: string
  user_id: string
  name: string
  description: string | null
  is_default: boolean
  created_at: string
  updated_at: string
  items?: WatchlistItem[]
}

export interface WatchlistItem {
  id: string
  watchlist_id: string
  team_id: string | null
  league_id: string | null
  event_id: string | null
  source_id: string | null
  notes: string | null
  created_at: string
  team?: Team
  league?: League
  event?: Event
  source?: MarketSource
}

export interface Alert {
  id: string
  user_id: string
  name: string
  description: string | null
  alert_type: AlertType
  status: AlertStatus
  conditions: AlertConditions
  event_id: string | null
  league_id: string | null
  team_id: string | null
  source_id: string | null
  notification_channels: string[]
  trigger_count: number
  last_triggered_at: string | null
  created_at: string
  updated_at: string
  event?: Event
  league?: League
  team?: Team
  source?: MarketSource
}

export interface AlertConditions {
  threshold?: number
  direction?: 'up' | 'down' | 'any'
  market_type?: MarketType
  source_a?: string
  source_b?: string
  threshold_pct?: number
  minutes_before?: number
}

export interface NotificationPreferences {
  id: string
  user_id: string
  email_alerts: boolean
  email_digest: boolean
  email_digest_frequency: 'instant' | 'daily' | 'weekly'
  push_alerts: boolean
  sms_alerts: boolean
  sms_number: string | null
  in_app_alerts: boolean
  marketing_emails: boolean
  created_at: string
  updated_at: string
}

export interface FeatureFlag {
  id: string
  key: string
  name: string
  description: string | null
  is_enabled: boolean
  enabled_for_tiers: SubscriptionTier[]
  enabled_for_user_ids: string[]
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  user_id: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  user?: Profile
}

// ============================================================
// UI / VIEW TYPES
// ============================================================

export interface MarketRow {
  event: Event
  snapshots: MarketSnapshot[]
  latest_snapshot: MarketSnapshot | null
  sources: MarketSource[]
  movement_24h: number
  divergence_pct: number | null
}

export interface DivergenceAlert {
  event: Event
  sportsbook_prob: number
  prediction_prob: number
  divergence_pct: number
  sportsbook_source: MarketSource
  prediction_source: MarketSource
}

export interface PricingPlan {
  id: string
  name: string
  tier: SubscriptionTier
  price_monthly: number
  price_yearly: number
  stripe_monthly_price_id: string
  stripe_yearly_price_id: string
  features: string[]
  is_popular: boolean
}

export interface StatCard {
  label: string
  value: string | number
  change?: number
  change_label?: string
  trend?: 'up' | 'down' | 'flat'
}

export type SortDirection = 'asc' | 'desc'

export interface PaginationState {
  page: number
  pageSize: number
  total: number
}

export interface FilterState {
  leagues: string[]
  sources: string[]
  market_types: MarketType[]
  search: string
}
