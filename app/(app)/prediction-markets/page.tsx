import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProGate } from '@/components/shared/pro-gate'
import { PredictionTable } from '@/components/prediction-markets/prediction-table'
import { Badge } from '@/components/ui/badge'
import { isUpcomingEvent } from '@/lib/queries'

export const metadata = { title: 'Prediction Markets' }

export default async function PredictionMarketsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('subscription_tier, subscription_status').eq('id', user.id).single()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'

  const { data: predictionsRaw } = await supabase
    .from('prediction_market_snapshots')
    .select(`
      *,
      event:events(id, title, start_time, league:leagues(name, abbreviation)),
      source:market_sources(id, name, slug),
      sportsbook_source:market_sources!prediction_market_snapshots_sportsbook_source_id_fkey(id, name)
    `)
    .order('snapshot_time', { ascending: false })
    .limit(isPro ? 300 : 60)

  // Pre-game only: keep unmatched contracts + contracts tied to upcoming events only
  const predictions = (predictionsRaw ?? []).filter(p => {
    const eventStart = (p as any).event?.start_time
    if (!eventStart) return true  // Unmatched Kalshi/Polymarket contracts — keep
    return isUpcomingEvent(eventStart)
  }).slice(0, isPro ? 100 : 20)

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-lg font-bold text-white">Prediction Markets</h1>
          <Badge variant="pro">PRO</Badge>
        </div>
        <p className="text-xs text-nb-400">
          Pre-game prediction market probabilities compared against sportsbook-implied prices
        </p>
      </div>

      <div className="rounded-lg border border-border bg-nb-900 px-4 py-3 text-xs text-nb-400 leading-relaxed">
        <strong className="text-nb-300">Informational only:</strong> Prediction market prices are crowd-sourced
        probability estimates displayed for research purposes. Not financial or gambling advice. Data may be delayed.
      </div>

      <ProGate isPro={isPro} featureName="Prediction Market Comparison" blur={false}>
        <PredictionTable predictions={predictions ?? []} />
      </ProGate>
    </div>
  )
}
