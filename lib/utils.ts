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

// ============================================================
// MARKET SHAPE
// ============================================================

// Sports whose standard h2h/moneyline market is 3-way (home/draw/away)
const THREE_WAY_SPORTS = new Set(['soccer', 'football_soccer'])

// League slugs that are 3-way moneyline (all soccer leagues).
// Intentionally comprehensive — every soccer slug from DB migrations + Odds API mappings.
const THREE_WAY_LEAGUES = new Set([
  // Tier 1
  'epl', 'mls', 'laliga', 'bundesliga', 'seria_a', 'ligue_one', 'eredivisie',
  'liga_portugal', 'spl',
  // Americas
  'liga_mx', 'brazil_serie_a', 'brazil_serie_b', 'copa_libertadores', 'copa_sudamericana',
  'argentina_primera', 'chile_primera', 'league_of_ireland',
  // UEFA
  'ucl', 'uel', 'uecl', 'ucl_women', 'fa_cup', 'dfb_pokal', 'copa_del_rey', 'coupe_de_france',
  // Second tiers
  'efl_champ', 'efl_league1', 'efl_league2', 'championship', 'league_one', 'league_two',
  'scottish_prem', 'bundesliga2', 'bundesliga3', 'la_liga2', 'ligue_two', 'serie_b',
  // Europe
  'austria_bundesliga', 'belgium_pro_a', 'swiss_super', 'swiss_super_league',
  'belgian_pro_league', 'super_lig', 'turkish_super_lig', 'frauen_bundesliga',
  'norway_eliteserien', 'denmark_superliga', 'danish_superliga',
  'sweden_allsvenskan', 'swedish_allsvenskan', 'finland_veikkaus',
  'greece_super', 'ekstraklasa', 'russia_premier',
  // Asia / Middle East
  'j_league', 'k_league1', 'k_league', 'australia_aleague', 'a_league',
  'china_super', 'saudi_pro', 'saudi_pro_league', 'isl',
  // International
  'fifa_wc', 'fifa_world_cup', 'fifa_womens_world_cup', 'wcq_europe',
  'uefa_euro', 'copa_america', 'concacaf_nations', 'africa_cup',
  // NWSL / NCAA
  'nwsl', 'ncaasoccer',
])

export type MarketShape = '2way' | '3way'

export function getMarketShape(
  leagueSlug: string | null | undefined,
  sportSlug: string | null | undefined,
  marketType: string
): MarketShape {
  if (marketType !== 'moneyline') return '2way'
  if (leagueSlug && THREE_WAY_LEAGUES.has(leagueSlug)) return '3way'
  if (sportSlug && THREE_WAY_SPORTS.has(sportSlug)) return '3way'
  return '2way'
}

export function isValidArbMarket(
  shape: MarketShape,
  homePrice: number | null,
  drawPrice: number | null,
  awayPrice: number | null
): boolean {
  if (shape === '3way') {
    return homePrice != null && drawPrice != null && awayPrice != null
  }
  return homePrice != null && awayPrice != null
}

export function calcCombinedProb(
  shape: MarketShape,
  homeProb: number,
  drawProb: number | null,
  awayProb: number
): number {
  if (shape === '3way' && drawProb != null) {
    return homeProb + drawProb + awayProb
  }
  return homeProb + awayProb
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
