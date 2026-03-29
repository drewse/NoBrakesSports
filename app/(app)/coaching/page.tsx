import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { BookingCalendar } from './booking-calendar'
import { Shield, DollarSign, Gift, TrendingUp, Clock, Users } from 'lucide-react'

export const metadata = { title: '1-on-1 Method Coaching' }

const PERKS = [
  {
    icon: Gift,
    title: 'Intro & Welcome Bonuses',
    desc: 'Walk through every sportsbook signup bonus step-by-step to capture maximum value from day one.',
  },
  {
    icon: DollarSign,
    title: 'Reload & Ongoing Promos',
    desc: 'Learn which books have the best recurring promotions and how to consistently extract value.',
  },
  {
    icon: TrendingUp,
    title: 'Odds Boosts & Profit Boosts',
    desc: 'Identify and size bets on enhanced-odds promotions to lock in guaranteed edge.',
  },
  {
    icon: Shield,
    title: 'Risk-Free Bet Strategy',
    desc: 'Maximize no-sweat and risk-free bet offers by hedging with sharp lines.',
  },
  {
    icon: Users,
    title: 'Referral Programs',
    desc: 'Stack referral bonuses across your network to multiply promotional earnings.',
  },
  {
    icon: Clock,
    title: 'Account Longevity',
    desc: 'Tactics for staying under the radar and keeping accounts healthy longer.',
  },
]

export default async function CoachingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch user's existing bookings to block off taken slots
  const { data: bookings } = await supabase
    .from('coaching_bookings')
    .select('scheduled_at, status')
    .eq('user_id', user.id)
    .gte('scheduled_at', new Date().toISOString())

  // Fetch all confirmed/pending bookings to show globally taken slots
  const { data: allBookings } = await supabase
    .from('coaching_bookings')
    .select('scheduled_at, status')
    .in('status', ['pending', 'confirmed'])
    .gte('scheduled_at', new Date().toISOString())

  return (
    <div className="p-6 space-y-6 max-w-[1100px]">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-white mb-1">1-on-1 Method Coaching</h1>
        <p className="text-xs text-nb-400">
          Book a private 30-minute session with a No Brakes admin to maximize your sportsbook intro
          and promotional bonuses.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* Left — info */}
        <div className="space-y-5">
          {/* What you get */}
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="p-5">
              <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-4">
                What We Cover
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PERKS.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-nb-800 border border-nb-700">
                      <Icon className="h-4 w-4 text-nb-300" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white mb-0.5">{title}</p>
                      <p className="text-[11px] text-nb-500 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Session details */}
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="p-5 space-y-3">
              <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider">
                Session Details
              </p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg bg-nb-800 p-3">
                  <p className="text-lg font-bold text-white">30</p>
                  <p className="text-[10px] text-nb-500 uppercase tracking-wider">Minutes</p>
                </div>
                <div className="rounded-lg bg-nb-800 p-3">
                  <p className="text-lg font-bold text-white">Free</p>
                  <p className="text-[10px] text-nb-500 uppercase tracking-wider">Cost</p>
                </div>
                <div className="rounded-lg bg-nb-800 p-3">
                  <p className="text-lg font-bold text-white">Zoom</p>
                  <p className="text-[10px] text-nb-500 uppercase tracking-wider">Format</p>
                </div>
              </div>
              <p className="text-[11px] text-nb-500 leading-relaxed">
                After booking, an admin will confirm your slot via the Chat tab and send you a Zoom
                link. All times are displayed in your local timezone.
              </p>
            </CardContent>
          </Card>

          {/* User's upcoming bookings */}
          {(bookings ?? []).filter(b => b.status !== 'cancelled').length > 0 && (
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-5">
                <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-3">
                  Your Upcoming Sessions
                </p>
                <div className="space-y-2">
                  {(bookings ?? [])
                    .filter(b => b.status !== 'cancelled')
                    .map(b => (
                      <div key={b.scheduled_at} className="flex items-center justify-between rounded-lg bg-nb-800 px-3 py-2">
                        <span className="text-xs text-white">
                          {new Date(b.scheduled_at).toLocaleString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                            hour: 'numeric', minute: '2-digit',
                          })}
                        </span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${
                          b.status === 'confirmed'
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-nb-700 text-nb-300'
                        }`}>
                          {b.status}
                        </span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right — calendar */}
        <Card className="bg-nb-900 border-nb-800 h-fit">
          <CardContent className="p-5">
            <p className="text-xs font-semibold text-nb-400 uppercase tracking-wider mb-4">
              Choose a Time (EST)
            </p>
            <BookingCalendar
              userId={user.id}
              existingBookings={allBookings ?? []}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
