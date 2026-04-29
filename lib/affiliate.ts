/**
 * Shared affiliate-code validation. Used by both the API route (server)
 * and the create form (client) so the rules can't drift.
 *
 * Rules: lowercase, letters/digits/hyphens/underscores, 3-30 chars.
 * The DB enforces the same shape via a CHECK constraint — see
 * `supabase/migrations/029_affiliate_program.sql`.
 */

export const AFFILIATE_CODE_MIN = 3
export const AFFILIATE_CODE_MAX = 30
export const AFFILIATE_CODE_PATTERN = /^[a-z0-9_-]{3,30}$/

export type AffiliateType = 'affiliate' | 'creator' | 'partner'
export type AffiliateStatus = 'active' | 'pending' | 'disabled'

export interface Affiliate {
  id: string
  user_id: string
  code: string
  email: string
  type: AffiliateType
  status: AffiliateStatus
  created_at: string
  updated_at: string
}

/** Sanitize freeform input into a candidate affiliate code. */
export function sanitizeAffiliateCode(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    // strip whitespace inside as well
    .replace(/\s+/g, '')
    // collapse anything illegal into nothing
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, AFFILIATE_CODE_MAX)
}

/** Returns null if valid, else a human-friendly error message. */
export function validateAffiliateCode(code: string): string | null {
  if (!code) return 'Code is required.'
  if (code.length < AFFILIATE_CODE_MIN) {
    return `Code must be at least ${AFFILIATE_CODE_MIN} characters.`
  }
  if (code.length > AFFILIATE_CODE_MAX) {
    return `Code must be at most ${AFFILIATE_CODE_MAX} characters.`
  }
  if (!AFFILIATE_CODE_PATTERN.test(code)) {
    return 'Use only lowercase letters, numbers, hyphens, and underscores.'
  }
  return null
}
