/**
 * PATCH /api/admin/coaching-bookings/[id]
 *
 * Body (any subset):
 *   { status?: 'pending' | 'confirmed' | 'completed' | 'cancelled',
 *     admin_notes?: string | null }
 *
 * Admin-only. Server-side admin verification on top of RLS so
 * non-admin requests fail fast with 403 even before the DB rejects.
 *
 * Users cannot reach this route — the admin gate sits ahead of any
 * write. Users also cannot manually patch admin-only fields via the
 * client SDK because the existing RLS policy on coaching_bookings
 * (migration 006, "Users update own pending bookings") only allows
 * users to update their OWN row AND only when status='pending', and
 * that policy doesn't whitelist `admin_notes` — Supabase RLS allows
 * column-level access via column-level USING expressions but here
 * we keep it simple: admin_notes only ever written through this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendBookingConfirmedMessage, sendBookingCancelledMessage } from '@/lib/coaching/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VALID_STATUSES = new Set(['pending', 'confirmed', 'completed', 'cancelled'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  if ('status' in body) {
    if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 })
    }
    update.status = body.status
    // Stamp the admin who took the action.
    update.admin_id = user.id
  }
  if ('admin_notes' in body) {
    if (body.admin_notes === null) {
      update.admin_notes = null
    } else if (typeof body.admin_notes === 'string') {
      update.admin_notes = body.admin_notes.slice(0, 4000)
    } else {
      return NextResponse.json({ error: 'admin_notes must be string or null' }, { status: 400 })
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'no updatable fields' }, { status: 400 })
  }

  // We need the booking shape (user, time, topic, discord) to compose
  // the auto-message AND the previous status to decide whether the
  // status change actually crossed a notification boundary. Fetch
  // before the update — Supabase doesn't return previous-state on
  // .update() and we want to avoid a second round-trip.
  const { data: before } = await supabase
    .from('coaching_bookings')
    .select('user_id, status, scheduled_at, duration_minutes, topic, discord_username')
    .eq('id', id)
    .single()

  const { error } = await supabase
    .from('coaching_bookings')
    .update(update)
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify the user via chat when the status actually transitioned.
  // Idempotent against double-clicks because we compare before.status
  // to the new status — confirming an already-confirmed booking is a
  // no-op for messaging.
  if (before && update.status && before.status !== update.status) {
    if (update.status === 'confirmed') {
      await sendBookingConfirmedMessage(supabase, {
        senderId: user.id,
        roomId: before.user_id as string,
        scheduledAt: before.scheduled_at as string,
        durationMinutes: (before.duration_minutes as number) ?? 20,
        topic: (before.topic as string | null) ?? null,
        discordUsername: (before.discord_username as string | null) ?? null,
      })
    } else if (update.status === 'cancelled') {
      await sendBookingCancelledMessage(supabase, {
        senderId: user.id,
        roomId: before.user_id as string,
        scheduledAt: before.scheduled_at as string,
        reason: 'declined',
      })
    }
  }

  return NextResponse.json({ ok: true })
}
