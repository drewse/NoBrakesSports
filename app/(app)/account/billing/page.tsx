import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Check, Zap, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createCheckoutSession, createPortalSession } from '@/lib/stripe/actions'
import { PRICING_PLANS } from '@/lib/stripe/client'
import { formatDate } from '@/lib/utils'

export const metadata = { title: 'Billing' }

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_status, subscription_period_end, stripe_customer_id')
    .eq('id', user.id)
    .single()

  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-[700px] space-y-6">
      <h1 className="text-lg font-bold text-white">Billing</h1>

      {/* Current plan */}
      <Card>
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>Current Plan</CardTitle>
            <Badge variant={isPro ? 'pro' : 'muted'}>
              {isPro ? 'PRO' : 'FREE'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {isPro ? (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">Pro Plan · $50/month</p>
                  {profile?.subscription_period_end && (
                    <p className="text-xs text-nb-400 mt-0.5">
                      Renews {formatDate(profile.subscription_period_end)}
                    </p>
                  )}
                </div>
                <form action={createPortalSession}>
                  <Button type="submit" variant="outline" size="sm">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Manage billing
                  </Button>
                </form>
              </div>
              <div className="rounded-lg border border-border bg-nb-900 p-4 text-xs text-nb-400">
                Cancel, downgrade, or update payment method via the billing portal.
              </div>
            </>
          ) : (
            <div>
              <p className="text-sm text-nb-300 mb-4">
                You&apos;re on the Free plan. Upgrade to Pro for real-time data, full history, alerts, and more.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Monthly */}
                <div className="rounded-lg border border-border bg-nb-900 p-4">
                  <p className="text-xs text-nb-400 mb-1">Monthly</p>
                  <p className="text-2xl font-bold text-white mb-0.5">$50</p>
                  <p className="text-xs text-nb-500 mb-4">per month</p>
                  <form action={createCheckoutSession}>
                    <input type="hidden" name="priceId" value={PRICING_PLANS.pro.stripe_monthly_price_id} />
                    <input type="hidden" name="userId" value={user.id} />
                    <Button type="submit" className="w-full" size="sm">
                      <Zap className="h-3.5 w-3.5" /> Upgrade Monthly
                    </Button>
                  </form>
                </div>
                {/* Yearly */}
                <div className="rounded-lg border border-white/20 bg-nb-900 p-4 relative">
                  <div className="absolute -top-2.5 right-3">
                    <Badge variant="white" className="text-[10px]">Save $120</Badge>
                  </div>
                  <p className="text-xs text-nb-400 mb-1">Yearly</p>
                  <p className="text-2xl font-bold text-white mb-0.5">$480</p>
                  <p className="text-xs text-nb-500 mb-4">per year ($40/mo)</p>
                  <form action={createCheckoutSession}>
                    <input type="hidden" name="priceId" value={PRICING_PLANS.pro.stripe_yearly_price_id} />
                    <input type="hidden" name="userId" value={user.id} />
                    <Button type="submit" className="w-full" size="sm">
                      <Zap className="h-3.5 w-3.5" /> Upgrade Yearly
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pro features list */}
      {!isPro && (
        <Card>
          <CardHeader className="border-b border-border pb-4">
            <CardTitle>What&apos;s included in Pro</CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            <ul className="space-y-2.5">
              {PRICING_PLANS.pro.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-nb-300">
                  <Check className="h-4 w-4 text-white mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Legal */}
      <p className="text-xs text-nb-500">
        Payments processed securely by Stripe. Cancel anytime through the billing portal.
        By subscribing, you agree to our{' '}
        <a href="/terms" className="underline hover:text-nb-300">Terms of Service</a>.
      </p>
    </div>
  )
}
