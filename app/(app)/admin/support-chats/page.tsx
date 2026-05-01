import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SupportInbox, type ConversationRow, type Message } from './inbox-client'

export const metadata = { title: 'Support Chats · Admin' }
export const dynamic = 'force-dynamic'

/**
 * /admin/support-chats — admin-only support inbox.
 *
 * Shape: derived view over chat_messages (existing) + chat_room_state
 * (migration 034). The user-facing /chat page is untouched; this page
 * just adds an admin perspective with status / read-tracking / search /
 * sort capabilities.
 */
export default async function SupportChatsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) redirect('/odds')

  // Pull every distinct room with its latest message + per-user
  // profile + admin-side state. Built as three small queries +
  // in-memory join so we don't need a SQL view (and so the Supabase
  // client doesn't get tangled up in nested joins on a small dataset).
  //
  // Scale note: chat traffic is admin-tier low. If/when this grows
  // past a few hundred active rooms, swap to a Postgres function
  // returning the joined rows.

  // 1. Newest message per room. Pull the last 1000 messages and
  // collapse client-side. Way under PostgREST's max-rows cap.
  const { data: recentMsgs } = await supabase
    .from('chat_messages')
    .select('id, room_id, sender_id, content, is_admin_sender, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  const allMsgs = (recentMsgs ?? []) as Message[]

  // Group by room — keep first (newest) message per room as the preview.
  const newestByRoom = new Map<string, Message>()
  for (const m of allMsgs) {
    if (!newestByRoom.has(m.room_id)) newestByRoom.set(m.room_id, m)
  }
  const roomIds = [...newestByRoom.keys()]
  if (roomIds.length === 0) {
    return <SupportInbox initial={[]} adminId={user.id} />
  }

  // 2. Profile metadata for each room owner (room_id == profile.id).
  const { data: profileRows } = await supabase
    .from('profiles')
    .select('id, full_name, email, username, avatar_url, subscription_tier, subscription_status, is_admin')
    .in('id', roomIds)
  const profileById = new Map((profileRows ?? []).map(p => [p.id, p]))

  // 3. Admin-side state for each room (status, last_admin_read_at).
  // Rooms with no row in chat_room_state are treated as 'open' with
  // last_admin_read_at = null (so every user message counts as unread).
  const { data: stateRows } = await supabase
    .from('chat_room_state')
    .select('room_id, status, last_admin_read_at, assigned_admin_id, closed_at')
    .in('room_id', roomIds)
  const stateByRoom = new Map((stateRows ?? []).map(s => [s.room_id, s]))

  // 4. Compute unread count per room — messages from the user with
  // created_at > last_admin_read_at. Done in-memory by walking the
  // 1000-msg window we already pulled. Caps unread at 99 in the UI
  // anyway, so the window is sufficient.
  const unreadByRoom = new Map<string, number>()
  for (const m of allMsgs) {
    if (m.is_admin_sender) continue
    const cutoff = stateByRoom.get(m.room_id)?.last_admin_read_at
    if (!cutoff || m.created_at > cutoff) {
      unreadByRoom.set(m.room_id, (unreadByRoom.get(m.room_id) ?? 0) + 1)
    }
  }

  const conversations: ConversationRow[] = roomIds.map(roomId => {
    const last = newestByRoom.get(roomId)!
    const prof = profileById.get(roomId)
    const state = stateByRoom.get(roomId)
    const status = (state?.status ?? 'open') as 'open' | 'closed'
    const isPro = prof?.subscription_tier === 'pro' && prof?.subscription_status === 'active'
    const userPlan: 'admin' | 'pro' | 'free' = prof?.is_admin ? 'admin' : isPro ? 'pro' : 'free'
    // Needs response when latest message is from the user AND status
    // is open AND the user message is newer than the admin's last
    // read marker (i.e., admin hasn't acknowledged it yet).
    const cutoff = state?.last_admin_read_at ?? null
    const needsResponse =
      status !== 'closed' &&
      !last.is_admin_sender &&
      (cutoff == null || last.created_at > cutoff)
    return {
      roomId,
      userName: prof?.full_name ?? prof?.username ?? prof?.email ?? 'Unknown user',
      userEmail: prof?.email ?? '',
      avatarUrl: prof?.avatar_url ?? null,
      userPlan,
      lastMessagePreview: last.content.slice(0, 200),
      lastMessageAt: last.created_at,
      lastMessageFromAdmin: last.is_admin_sender,
      unreadCount: unreadByRoom.get(roomId) ?? 0,
      needsResponse,
      status,
      assignedAdminId: state?.assigned_admin_id ?? null,
      closedAt: state?.closed_at ?? null,
    }
  })

  // Default sort: needs-response first, then most recent activity.
  conversations.sort((a, b) => {
    if (a.needsResponse !== b.needsResponse) return a.needsResponse ? -1 : 1
    return b.lastMessageAt.localeCompare(a.lastMessageAt)
  })

  return <SupportInbox initial={conversations} adminId={user.id} />
}
