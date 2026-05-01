import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { BookingCalendar } from './booking-calendar'
import {
  Shield, DollarSign, Gift, TrendingUp, Clock, Users, AlertTriangle,
} from 'lucide-react'
import { DiscordButton } from '@/components/shared/discord-button'

export const metadata = { title: '1-on-1 Method Coaching' }

const PERKS = [
  { icon: Gift,        title: 'Intro & Welcome Bonuses',   desc: 'Walk through every sportsbook signup bonus step-by-step.' },
  { icon: DollarSign,  title: 'Reload & Ongoing Promos',   desc: 'Best recurring promos and how to consistently extract value.' },
  { icon: TrendingUp,  title: 'Odds & Profit Boosts',      desc: 'Identify and size bets on enhanced-odds promos.' },
  { icon: Shield,      title: 'Risk-Free Bet Strategy',    desc: 'Maximize no-sweat bets by hedging with sharp lines.' },
  { icon: Users,       title: 'Referral Programs',         desc: 'Stack referrals across your network to multiply earnings.' },
  { icon: Clock,       title: 'Account Longevity',         desc: 'Tactics for staying under the radar.' },
]

export default async function CoachingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Pull profile so we can prefill discord_username if the user
  // already has one on file (we don't capture that today, but the
  // BookingCalendar accepts an initial value so adding the column
  // later is a one-line wire-up).
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, email, username')
    .eq('id', user.id)
    .single()

  const [{ data: bookings }, { data: allBookings }] = await Promise.all([
    supabase
      .from('coaching_bookings')
      .select('scheduled_at, status')
      .eq('user_id', user.id)
      .gte('scheduled_at', new Date().toISOString()),
    supabase
      .from('coaching_bookings')
      .select('scheduled_at, status')
      .in('status', ['pending', 'confirmed'])
      .gte('scheduled_at', new Date().toISOString()),
  ])

  const myUpcoming = (bookings ?? []).filter(b => b.status !== 'cancelled')

  return (
    // Compact vertical rhythm so the booking flow fits above the fold
    // on a 1080p / 14" laptop screen. Older layout used space-y-6 +
    // generous padding which pushed the calendar below the visible
    // viewport on smaller laptops.
    <div className="p-3 sm:p-4 lg:p-6 max-w-[1200px]">
      {/* Header — single line on desktop to save vertical space */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-white">1-on-1 Method Coaching</h1>
          <p className="text-xs text-nb-400 mt-0.5">
            Private 20-min session with a No Brakes admin · Free · Zoom
          </p>
        </div>
        <DiscordButton size="sm" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-4 lg:gap-6">
        {/* ── Left column — info, dense ─────────────────────────── */}
        <div className="space-y-3">
          {/* What we cover — tighter grid */}
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="p-4">
              <p className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider mb-3">
                What We Cover
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {PERKS.map(({ icon: Icon, title, desc }) => (
                  <div key={title} className="flex gap-2.5">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-nb-800 border border-nb-700">
                      <Icon className="h-3.5 w-3.5 text-nb-300" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-white leading-tight">{title}</p>
                      <p className="text-[10px] text-nb-500 leading-snug mt-0.5">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Disclaimer / rules — front and center near the booking
            * area on mobile (above the calendar in column flow), and
            * adjacent to it on desktop. */}
          <Card className="bg-amber-500/[0.04] border-amber-500/20">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">
                  Before you book
                </p>
              </div>
              <ul className="text-[11px] text-nb-300 leading-relaxed space-y-1.5 list-disc list-inside marker:text-amber-400/60">
                <li>Join the No Brakes Discord using the same name you provide below.</li>
                <li>If you are more than <span className="text-white font-semibold">5 minutes late</span>, your session is forfeited.</li>
                <li>An admin will confirm your slot and send a Zoom link via Chat or Discord.</li>
              </ul>
              <div className="pt-1">
                <DiscordButton size="sm" label="Join Discord first" />
              </div>
            </CardContent>
          </Card>

          {/* User's upcoming bookings — compact list, only when there are any */}
          {myUpcoming.length > 0 && (
            <Card className="bg-nb-900 border-nb-800">
              <CardContent className="p-4">
                <p className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider mb-2">
                  Your Upcoming Sessions
                </p>
                <ul className="space-y-1.5">
                  {myUpcoming.map(b => (
                    <li
                      key={b.scheduled_at}
                      className="flex items-center justify-between rounded-md bg-nb-800 px-3 py-2"
                    >
                      <span className="text-[11px] text-white">
                        {new Date(b.scheduled_at).toLocaleString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit',
                        })}
                      </span>
                      <span className={`text-[9px] font-semibold px-2 py-0.5 rounded capitalize ${
                        b.status === 'confirmed'
                          ? 'bg-green-500/15 text-green-400'
                          : 'bg-nb-700 text-nb-300'
                      }`}>
                        {b.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>

        {/* ── Right column — sticky calendar + form ────────────── */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="bg-nb-900 border-nb-800">
            <CardContent className="p-4">
              <BookingCalendar
                userId={user.id}
                userName={profile?.full_name ?? profile?.username ?? profile?.email ?? null}
                userEmail={profile?.email ?? null}
                existingBookings={allBookings ?? []}
                userBookings={bookings ?? []}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
