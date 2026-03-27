import Stripe from 'stripe'

// Lazy singleton — avoids throwing at build time when env vars aren't present
let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set')
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-02-24.acacia',
      typescript: true,
    })
  }
  return _stripe
}

// Backwards-compatible named export used in webhook and actions
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop]
  },
})

export const PRICING_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    tier: 'free' as const,
    price_monthly: 0,
    price_yearly: 0,
    stripe_monthly_price_id: '',
    stripe_yearly_price_id: '',
    features: [
      'Limited market overview (24h delayed)',
      'Basic league tracking',
      'Up to 5 watchlist items',
      'Demo data access',
      'Community access',
    ],
    is_popular: false,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tier: 'pro' as const,
    price_monthly: 50,
    price_yearly: 480,
    stripe_monthly_price_id: process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? '',
    stripe_yearly_price_id: process.env.STRIPE_PRO_YEARLY_PRICE_ID ?? '',
    features: [
      'Real-time market data across all sources',
      'Full line movement history',
      'Prediction market comparisons',
      'Unlimited watchlist items',
      'Custom alerts & notifications',
      'Advanced filters & saved views',
      'Historical analytics dashboard',
      'Data export (CSV)',
      'Priority support',
      'Early access to new features',
    ],
    is_popular: true,
  },
}
