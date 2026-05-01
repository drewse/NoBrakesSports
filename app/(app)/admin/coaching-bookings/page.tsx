import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CoachingBookingsClient, type AdminBooking } from './bookings-client'

export const metadata = { title: 'Coaching Bookings · Admin' }
export const dynamic = 'force-dynamic'

/**
 * /admin/coaching-bookings — admin-only triage view for 1-on-1 coaching
 * sessions. Pulls every booking + the user profile + (if set) the
 * admin who took ownership. Filtering / status actions handled in the
 * client component.
 */
export default async function CoachingBookingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) redirect('/odds')

  // Pull all bookings — RLS allows because of "Admins read all
  // bookings" policy on coaching_bookings (migration 006).
  const { data: bookings } = await supabase
    .from('coaching_bookings')
    .select(`
      id, user_id, scheduled_at, duration_minutes, status, topic,
      user_notes, admin_notes, discord_username, created_at, updated_at
    `)
    .order('scheduled_at', { ascending: true })
    .limit(500)

  const userIds = Array.from(new Set((bookings ?? []).map(b => b.user_id)))
  const { data: userProfiles } = userIds.length
    ? await supabase
        .from('profiles')
        .select('id, full_name, email, username, subscription_tier, subscription_status')
        .in('id', userIds)
    : { data: [] }
  const profileById = new Map((userProfiles ?? []).map(p => [p.id, p]))

  const adminBookings: AdminBooking[] = (bookings ?? []).map(b => {
    const p = profileById.get(b.user_id)
    const isPro = p?.subscription_tier === 'pro' && p?.subscription_status === 'active'
    return {
      id: b.id as string,
      userId: b.user_id as string,
      userName: p?.full_name ?? p?.username ?? p?.email ?? 'Unknown user',
      userEmail: p?.email ?? '',
      userPlan: isPro ? 'pro' : 'free',
      discordUsername: b.discord_username ?? null,
      scheduledAt: b.scheduled_at as string,
      durationMinutes: (b.duration_minutes as number) ?? 20,
      status: b.status as AdminBooking['status'],
      topic: b.topic as string | null,
      userNotes: b.user_notes as string | null,
      adminNotes: b.admin_notes as string | null,
      createdAt: b.created_at as string,
    }
  })

  return <CoachingBookingsClient initial={adminBookings} />
}
