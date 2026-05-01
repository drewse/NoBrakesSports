/**
 * Hourly cron: auto-cancel coaching bookings that admins haven't
 * confirmed within 24 hours of their creation, and post a "please
 * rebook" message to the user's chat room.
 *
 * Selection rule:
 *   status = 'pending'
 *   AND created_at < now() - 24h
 *
 * Note we use `created_at` (when the user requested the slot), not
 * `scheduled_at` (when the session is supposed to happen). A user
 * who books a session 3 days out shouldn't have admins panic-confirm
 * within 24h of the session — we just want admins to *acknowledge*
 * within 24h of the booking request. If admins miss that window, the
 * slot frees up and the user gets prompted to rebook.
 *
 * Uses the service-role admin client to bypass RLS (no authenticated
 * admin user during a cron run).
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendBookingCancelledMessage, pickSystemAdminId } from '@/lib/coaching/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const t0 = Date.now()
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  // Pick a system admin id ONCE per run so we don't query for every
  // booking. If the project has no admin yet, skip the notification
  // entirely — the bookings still get auto-cancelled, just silently.
  const systemAdminId = await pickSystemAdminId(supabase)

  const { data: stale, error: selectErr } = await supabase
    .from('coaching_bookings')
    .select('id, user_id, scheduled_at, created_at')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(200)
  if (selectErr) {
    return NextResponse.json({ error: selectErr.message }, { status: 500 })
  }

  if (!stale || stale.length === 0) {
    console.log(`[cron.auto-decline-coaching] no stale bookings ms=${Date.now() - t0}`)
    return NextResponse.json({ ok: true, cancelled: 0 })
  }

  const ids = stale.map(b => b.id)
  const { error: updateErr } = await supabase
    .from('coaching_bookings')
    .update({
      status: 'cancelled',
      admin_notes: 'Auto-cancelled: not confirmed within 24h of request.',
    })
    .in('id', ids)
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  let notified = 0
  if (systemAdminId) {
    for (const b of stale) {
      await sendBookingCancelledMessage(supabase, {
        senderId: systemAdminId,
        roomId: b.user_id as string,
        scheduledAt: b.scheduled_at as string,
        reason: 'auto_expired',
      })
      notified++
    }
  } else {
    console.warn('[cron.auto-decline-coaching] no admin profile found — skipping chat notifications')
  }

  console.log(
    `[cron.auto-decline-coaching] cancelled=${stale.length} notified=${notified} ms=${Date.now() - t0}`,
  )
  return NextResponse.json({ ok: true, cancelled: stale.length, notified })
}
