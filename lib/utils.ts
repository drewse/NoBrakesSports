import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, parseISO } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============================================================
// FORMATTING
// ============================================================

export function formatOdds(price: number | null | undefined): string {
  if (price == null) return '—'
  if (price > 0) return `+${price}`
  return `${price}`
}

export function formatImpliedProb(prob: number | null | undefined): string {
  if (prob == null) return '—'
  return `${(prob * 100).toFixed(1)}%`
}

export function formatPredictionPrice(price: number | null | undefined): string {
  if (price == null) return '—'
  return `${(price * 100).toFixed(1)}¢`
}

export function formatDivergence(pct: number | null | undefined): string {
  if (pct == null) return '—'
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)}%`
}

export function formatSpread(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value > 0) return `+${value}`
  return `${value}`
}

export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(cents / 100)
}

export function formatVolume(vol: number | null | undefined): string {
  if (vol == null) return '—'
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`
  return `$${vol.toFixed(0)}`
}

export function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d, yyyy')
}

export function formatDateTime(dateStr: string): string {
  return format(parseISO(dateStr), 'MMM d, h:mm a')
}

export function formatRelativeTime(dateStr: string): string {
  return formatDistanceToNow(parseISO(dateStr), { addSuffix: true })
}

export function formatEventTime(dateStr: string): string {
  return format(parseISO(dateStr), 'EEE MMM d • h:mm a zzz')
}

// ============================================================
// MARKET CALCULATIONS
// ============================================================

export function americanToImpliedProb(american: number): number {
  if (american > 0) {
    return 100 / (american + 100)
  } else {
    return Math.abs(american) / (Math.abs(american) + 100)
  }
}

export function impliedProbToAmerican(prob: number): number {
  if (prob >= 0.5) {
    return -Math.round((prob / (1 - prob)) * 100)
  } else {
    return Math.round(((1 - prob) / prob) * 100)
  }
}

export function calculateDivergence(
  sportsbookProb: number,
  predictionProb: number
): number {
  return ((predictionProb - sportsbookProb) / sportsbookProb) * 100
}

// ============================================================
// MISC
// ============================================================

export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return `${str.slice(0, maxLength)}...`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function isProUser(profile: { subscription_tier: string; subscription_status: string } | null): boolean {
  if (!profile) return false
  return profile.subscription_tier === 'pro' && profile.subscription_status === 'active'
}

export function getMovementColor(direction: string): string {
  if (direction === 'up') return 'text-white'
  if (direction === 'down') return 'text-nb-300'
  return 'text-nb-400'
}

export function getDivergenceColor(pct: number | null): string {
  if (pct == null) return 'text-nb-400'
  const abs = Math.abs(pct)
  if (abs >= 10) return 'text-white font-semibold'
  if (abs >= 5) return 'text-nb-200'
  return 'text-nb-400'
}
