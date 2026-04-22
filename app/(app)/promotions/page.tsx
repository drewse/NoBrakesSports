'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'

type PromoType = 'Welcome Bonus' | 'Reload' | 'Odds Boost' | 'Risk-Free' | 'Referral' | 'Free Bet'
type Region = 'CA' | 'US'

interface Promo {
  id: string
  book: string
  type: PromoType
  title: string
  value: string
  description: string
  terms: string
  url: string
  tag?: string // e.g. "Best Value", "Limited Time"
  states?: string // e.g. "US Only", "CA Only"
}

const TYPE_COLORS: Record<PromoType, string> = {
  'Welcome Bonus': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'Reload':        'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'Odds Boost':    'bg-purple-500/15 text-purple-300 border-purple-500/30',
  'Risk-Free':     'bg-green-500/15 text-green-300 border-green-500/30',
  'Referral':      'bg-pink-500/15 text-pink-300 border-pink-500/30',
  'Free Bet':      'bg-orange-500/15 text-orange-300 border-orange-500/30',
}

// Wiped — user is sourcing real promos per book and will add them back
// one-by-one. Keep this array empty so the page renders the empty state
// until the first real entry is added.
const PROMOS: Promo[] = []

const TYPE_ORDER: PromoType[] = ['Welcome Bonus', 'Risk-Free', 'Reload', 'Odds Boost', 'Free Bet', 'Referral']

/** Region match heuristic: check `states` first (explicit "CA Only" /
 *  "US Only"), otherwise leave undefined-region promos visible in both
 *  views so we don't accidentally hide promos that haven't been tagged. */
function matchesRegion(p: Promo, region: Region): boolean {
  const s = (p.states ?? '').toLowerCase()
  if (!s) return true
  if (region === 'CA') return s.includes('ca')
  return s.includes('us')
}

export default function PromotionsPage() {
  const [region, setRegion] = useState<Region>('CA')

  const visible = PROMOS.filter(p => matchesRegion(p, region))
  const grouped = TYPE_ORDER.map(type => ({
    type,
    promos: visible.filter(p => p.type === type),
  })).filter(g => g.promos.length > 0)

  const totalValue = visible.filter(p => p.type === 'Welcome Bonus').length

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1200px]">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white mb-1">Promotions</h1>
        <p className="text-xs text-nb-400">
          Curated sportsbook promotions — maximize your value from welcome bonuses, reloads, and ongoing offers.
          {' '}<span className="text-white font-medium">{totalValue} welcome bonuses</span> currently available.
        </p>
      </div>

      {/* Region toggle */}
      <div className="inline-flex rounded-lg border border-nb-800 bg-nb-900 p-0.5 gap-0.5">
        <button
          type="button"
          onClick={() => setRegion('CA')}
          className={`text-xs font-semibold px-3.5 py-1.5 rounded-md transition-colors ${
            region === 'CA'
              ? 'bg-nb-700 text-white'
              : 'text-nb-400 hover:text-white'
          }`}
          aria-pressed={region === 'CA'}
        >
          Canada Promotions
        </button>
        <button
          type="button"
          onClick={() => setRegion('US')}
          className={`text-xs font-semibold px-3.5 py-1.5 rounded-md transition-colors ${
            region === 'US'
              ? 'bg-nb-700 text-white'
              : 'text-nb-400 hover:text-white'
          }`}
          aria-pressed={region === 'US'}
        >
          USA Promotions
        </button>
      </div>

      {/* Disclaimer */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-[11px] text-amber-300/80 leading-relaxed">
          <span className="font-semibold text-amber-300">Heads up:</span> Promotion terms change frequently.
          Always verify the current offer on the sportsbook's website before depositing.
          Bonus bet values represent the potential bonus, not guaranteed cash.
        </p>
      </div>

      {/* Empty state */}
      {grouped.length === 0 && (
        <div className="rounded-lg border border-nb-800 bg-nb-900 px-6 py-10 text-center">
          <p className="text-sm text-nb-300 font-medium">
            No {region === 'CA' ? 'Canadian' : 'US'} promotions yet
          </p>
          <p className="text-[11px] text-nb-500 mt-1">
            Promotions will appear here as they're researched and added.
          </p>
        </div>
      )}

      {/* Sections by type */}
      {grouped.map(({ type, promos }) => (
        <div key={type} className="space-y-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-white">{type}</h2>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${TYPE_COLORS[type]}`}>
              {promos.length} offer{promos.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {promos.map(promo => (
              <Card key={promo.id} className="bg-nb-900 border-nb-800 hover:border-nb-600 transition-colors">
                <CardContent className="p-4 flex flex-col gap-3">
                  {/* Top row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-nb-800 border border-nb-700">
                        <span className="text-[9px] font-bold text-nb-300 leading-none">
                          {promo.book.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-nb-300 truncate">{promo.book}</p>
                        {promo.states && (
                          <p className="text-[9px] text-nb-600">{promo.states}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {promo.tag && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-white/10 text-white">
                          {promo.tag}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Value + title */}
                  <div>
                    <p className="text-xl font-bold text-white leading-none mb-1">{promo.value}</p>
                    <p className="text-xs font-medium text-nb-200">{promo.title}</p>
                  </div>

                  {/* Description */}
                  <p className="text-[11px] text-nb-400 leading-relaxed flex-1">
                    {promo.description}
                  </p>

                  {/* Terms */}
                  <p className="text-[10px] text-nb-600 leading-relaxed border-t border-nb-800 pt-2">
                    {promo.terms}
                  </p>

                  {/* CTA */}
                  <a
                    href={promo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 w-full rounded bg-nb-800 hover:bg-nb-700 border border-nb-700 text-xs font-semibold text-white py-2 transition-colors"
                  >
                    Claim Offer
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
