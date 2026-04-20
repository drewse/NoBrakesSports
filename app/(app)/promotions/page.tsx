import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink } from 'lucide-react'

export const metadata = { title: 'Promotions' }

type PromoType = 'Welcome Bonus' | 'Reload' | 'Odds Boost' | 'Risk-Free' | 'Referral' | 'Free Bet'

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

const PROMOS: Promo[] = [
  // ── Welcome Bonuses ───────────────────────────────────────────────────────
  {
    id: 'dk-welcome',
    book: 'DraftKings',
    type: 'Welcome Bonus',
    title: 'Bet $5, Get $200 in Bonus Bets',
    value: '$200',
    description: 'New users place a $5 bet and receive $200 in bonus bets instantly, regardless of outcome.',
    terms: '21+. New customers only. Bonus bets expire in 7 days. Must be in an eligible state.',
    url: 'https://sportsbook.draftkings.com',
    tag: 'Best Value',
    states: 'US Only',
  },
  {
    id: 'fd-welcome',
    book: 'FanDuel',
    type: 'Welcome Bonus',
    title: 'Bet $5, Get $200 in Bonus Bets',
    value: '$200',
    description: 'Place your first $5 wager and get $200 in bonus bets win or lose.',
    terms: '21+. New customers only. Bonus bets expire in 14 days.',
    url: 'https://sportsbook.fanduel.com',
    states: 'US Only',
  },
  {
    id: 'betmgm-welcome',
    book: 'BetMGM',
    type: 'Welcome Bonus',
    title: 'First Bet Offer Up to $1,500',
    value: '$1,500',
    description: 'If your first bet loses, BetMGM credits your account with bonus bets up to $1,500.',
    terms: '21+. New customers only. Bonus bets paid in 5 x 20% increments. 1x playthrough.',
    url: 'https://sports.betmgm.com',
    tag: 'Highest Cap',
    states: 'US Only',
  },
  {
    id: 'caesars-welcome',
    book: 'Caesars',
    type: 'Welcome Bonus',
    title: 'First Bet on Caesars up to $1,000',
    value: '$1,000',
    description: 'Your first bet is fully insured up to $1,000. If it loses, you get a bonus bet back.',
    terms: '21+. New customers only. Single bonus bet returned. 1x playthrough required.',
    url: 'https://sportsbook.caesars.com',
    states: 'US Only',
  },
  {
    id: 'espnbet-welcome',
    book: 'ESPN Bet',
    type: 'Welcome Bonus',
    title: 'First Bet Reset up to $1,000',
    value: '$1,000',
    description: 'Lose your first bet? ESPN Bet refunds it as a bonus bet up to $1,000.',
    terms: '21+. New customers only. Bonus bet expires in 7 days.',
    url: 'https://espnbet.com',
    states: 'US Only',
  },
  {
    id: 'si-welcome',
    book: 'Sports Interaction',
    type: 'Welcome Bonus',
    title: '100% Match Bonus up to $200',
    value: '$200',
    description: 'Deposit and receive a 100% match bonus on your first deposit up to $200.',
    terms: 'New customers. 5x rollover on deposit + bonus. Minimum odds -200.',
    url: 'https://www.sportsinteraction.com',
    tag: 'Canada',
    states: 'CA Only',
  },
  {
    id: 'thescore-welcome',
    book: 'theScore Bet',
    type: 'Welcome Bonus',
    title: 'Bet $50, Get $100 in Bonus Bets',
    value: '$100',
    description: 'New customers place a $50 bet and receive $100 in bonus bets.',
    terms: 'New customers. Minimum odds -200. Bonus bets expire in 7 days.',
    url: 'https://bet.thescore.com',
    states: 'CA Only',
  },

  // ── Risk-Free ─────────────────────────────────────────────────────────────
  {
    id: 'betrivers-nswb',
    book: 'BetRivers',
    type: 'Risk-Free',
    title: 'No-Sweat First Bet up to $500',
    value: '$500',
    description: 'First bet is protected. If it loses, get a bonus bet of equal value up to $500.',
    terms: '21+. New customers. Bonus bet expires 30 days. 1x playthrough.',
    url: 'https://www.betrivers.com',
    states: 'US Only',
  },
  {
    id: 'hardrock-nswb',
    book: 'Hard Rock Bet',
    type: 'Risk-Free',
    title: 'Second Chance Bet up to $500',
    value: '$500',
    description: 'If your first bet loses you get a second chance bonus bet up to $500.',
    terms: '21+. New customers. FL, NJ, TN, IN, VA only.',
    url: 'https://www.hardrock.bet',
    states: 'US Only',
  },

  // ── Reload ────────────────────────────────────────────────────────────────
  {
    id: 'betmgm-reload',
    book: 'BetMGM',
    type: 'Reload',
    title: 'Monday Night Football Parlay Boost',
    value: '+25%',
    description: 'Get a 25% profit boost on any same-game parlay placed on Monday Night Football.',
    terms: 'Existing customers. Opt-in required. Max $25 boost value.',
    url: 'https://sports.betmgm.com',
  },
  {
    id: 'dk-reload',
    book: 'DraftKings',
    type: 'Reload',
    title: 'Stepped Up Parlay Bonus',
    value: 'Up to +100%',
    description: 'Extra winnings on parlays: 3-leg +33%, 4-leg +50%, 5-leg +75%, 6+ leg +100%.',
    terms: 'Minimum odds -300 per leg. Max bonus $25 per parlay. Recurring weekly.',
    url: 'https://sportsbook.draftkings.com',
    tag: 'Recurring',
  },

  // ── Odds Boost ────────────────────────────────────────────────────────────
  {
    id: 'fd-boost',
    book: 'FanDuel',
    type: 'Odds Boost',
    title: 'Daily Odds Boosts',
    value: 'Varies',
    description: 'FanDuel offers multiple daily odds boosts across all major sports, typically 20–100% enhanced odds on featured markets.',
    terms: 'Max bet $25 on boosted odds. One per customer per boost. Check app daily.',
    url: 'https://sportsbook.fanduel.com',
    tag: 'Daily',
  },
  {
    id: 'caesars-boost',
    book: 'Caesars',
    type: 'Odds Boost',
    title: 'Profit Boosts',
    value: 'Up to +100%',
    description: 'Profit boost tokens that increase your winnings by a set percentage on eligible bets.',
    terms: 'Issued via promotions. Max boost varies. Check your active offers.',
    url: 'https://sportsbook.caesars.com',
    tag: 'Recurring',
  },

  // ── Referral ──────────────────────────────────────────────────────────────
  {
    id: 'dk-referral',
    book: 'DraftKings',
    type: 'Referral',
    title: 'Refer a Friend — $100 Each',
    value: '$100/referral',
    description: 'Refer a friend and both of you receive $100 in bonus bets when they place their first $25+ wager.',
    terms: 'Referred friend must be a new DraftKings customer. Limit 10 referrals.',
    url: 'https://sportsbook.draftkings.com',
    tag: 'Stackable',
  },
  {
    id: 'fd-referral',
    book: 'FanDuel',
    type: 'Referral',
    title: 'Refer a Friend — $75 Each',
    value: '$75/referral',
    description: 'Both you and your referred friend get $75 in bonus bets after they place their first bet.',
    terms: 'New FanDuel customer only. Must use your referral link. Limit 10 referrals.',
    url: 'https://sportsbook.fanduel.com',
    tag: 'Stackable',
  },

  // ── Free Bet ──────────────────────────────────────────────────────────────
  {
    id: 'betway-freebet',
    book: 'Betway',
    type: 'Free Bet',
    title: 'Weekly Free Bet Club',
    value: 'Up to $30/wk',
    description: 'Place qualifying bets each week to earn a free bet token. Higher activity = larger free bet.',
    terms: 'Opt-in required weekly. Qualifying bets must be at odds -200 or greater.',
    url: 'https://www.betway.com',
    states: 'CA Only',
  },
]

const TYPE_ORDER: PromoType[] = ['Welcome Bonus', 'Risk-Free', 'Reload', 'Odds Boost', 'Free Bet', 'Referral']

export default function PromotionsPage() {
  const grouped = TYPE_ORDER.map(type => ({
    type,
    promos: PROMOS.filter(p => p.type === type),
  })).filter(g => g.promos.length > 0)

  const totalValue = PROMOS.filter(p => p.type === 'Welcome Bonus').length

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

      {/* Disclaimer */}
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3">
        <p className="text-[11px] text-amber-300/80 leading-relaxed">
          <span className="font-semibold text-amber-300">Heads up:</span> Promotion terms change frequently.
          Always verify the current offer on the sportsbook's website before depositing.
          Bonus bet values represent the potential bonus, not guaranteed cash.
        </p>
      </div>

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
