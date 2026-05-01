/**
 * Helpers for posting "system" messages from the No Brakes Team to a
 * user's chat room when a coaching booking changes state. Used by:
 *
 *   • app/api/admin/coaching-bookings/[id]/route.ts — admin clicks
 *     Confirm / Cancel on the bookings page
 *
 *   • app/api/cron/auto-decline-coaching/route.ts — pending bookings
 *     not actioned within 24h are auto-cancelled and the user is
 *     prompted to rebook
 *
 * The message is inserted with `is_admin_sender = TRUE`. The
 * existing RLS policy on chat_messages requires EITHER:
 *   - profile.is_admin = TRUE (matches the calling admin user), OR
 *   - service-role key (bypasses RLS, used by the cron route)
 *
 * `senderId` should be a valid admin profile id when calling from the
 * admin PATCH route. For the cron path it's still required (the
 * sender_id column is NOT NULL with a profiles FK) — pass any admin
 * id you want recorded as the system author. If no admin exists, the
 * insert is skipped and we log a warning instead of crashing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const TOPIC_LABELS: Record<string, string> = {
  intro_bonus: 'Intro Bonus Walkthrough',
  reload_promos: 'Reload Promotions',
  odds_boosts: 'Odds & Profit Boosts',
  risk_free: 'Risk-Free Bet Strategy',
  refer_a_friend: 'Referral Programs',
  general: 'General Strategy',
}

function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
}

export async function sendBookingConfirmedMessage(
  supabase: SupabaseClient,
  opts: {
    senderId: string                  // admin profile id
    roomId: string                    // user_id
    scheduledAt: string
    durationMinutes: number
    topic: string | null
    discordUsername: string | null
  },
): Promise<void> {
  const topicLabel = opts.topic ? (TOPIC_LABELS[opts.topic] ?? opts.topic) : null
  const lines = [
    `✅ Booking confirmed!`,
    ``,
    `**When:** ${formatScheduledAt(opts.scheduledAt)}`,
    `**Duration:** ${opts.durationMinutes} minutes`,
    topicLabel ? `**Topic:** ${topicLabel}` : null,
    opts.discordUsername ? `**Discord:** ${opts.discordUsername}` : null,
    ``,
    `Join the No Brakes Discord before your session — we'll DM you the Zoom link there. If you're more than 5 minutes late your slot is forfeited.`,
  ].filter(Boolean).join('\n')

  await insertSystemMessage(supabase, opts.senderId, opts.roomId, lines)
}

export async function sendBookingCancelledMessage(
  supabase: SupabaseClient,
  opts: {
    senderId: string
    roomId: string
    scheduledAt: string
    reason: 'declined' | 'auto_expired'
  },
): Promise<void> {
  const when = formatScheduledAt(opts.scheduledAt)
  const lead = opts.reason === 'auto_expired'
    ? `Hey — we weren't able to confirm your coaching slot for ${when} in time.`
    : `Hey — we had to decline your coaching slot for ${when}.`
  const lines = [
    lead,
    ``,
    `Please rebook at a different time at /coaching. Sorry for the inconvenience — we'll lock in the next one.`,
  ].join('\n')

  await insertSystemMessage(supabase, opts.senderId, opts.roomId, lines)
}

async function insertSystemMessage(
  supabase: SupabaseClient,
  senderId: string,
  roomId: string,
  content: string,
): Promise<void> {
  const trimmed = content.slice(0, 4000)
  const { error } = await supabase
    .from('chat_messages')
    .insert({
      room_id: roomId,
      sender_id: senderId,
      content: trimmed,
      is_admin_sender: true,
    })
  if (error) {
    // Don't throw — booking state change should not be rolled back
    // because of a notification failure. The admin can still
    // re-message the user manually from the support inbox.
    console.error('[coaching.notify] failed to insert chat message', {
      roomId, error: error.message,
    })
  }
}

/**
 * Pick any admin profile id to use as the system message author. The
 * cron path doesn't have an authenticated admin user — Supabase
 * service role can bypass RLS but chat_messages.sender_id has a NOT
 * NULL FK to profiles, so we still need a real admin id to attach
 * the row to. Returns null if no admin exists, in which case the
 * caller should skip the notification.
 */
export async function pickSystemAdminId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('is_admin', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .single()
  return data?.id ?? null
}
