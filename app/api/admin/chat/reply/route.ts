/**
 * POST /api/admin/chat/reply
 *
 * Body: { roomId: string, content: string }
 *
 * Sends a message as the admin team. Server-side admin check —
 * users cannot pretend to be admin by hand-crafting `is_admin_sender:
 * true` against the user-facing client; that path is blocked by RLS.
 * This route adds an extra layer: even if the RLS policy were
 * loosened by mistake, this handler verifies `profile.is_admin`
 * before writing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
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
  const roomId: unknown = body?.roomId
  const content: unknown = body?.content
  if (typeof roomId !== 'string' || !roomId) {
    return NextResponse.json({ error: 'roomId required' }, { status: 400 })
  }
  if (typeof content !== 'string' || !content.trim()) {
    return NextResponse.json({ error: 'content required' }, { status: 400 })
  }
  // Match the table CHECK on length.
  const trimmed = content.trim().slice(0, 4000)

  // Insert + return the inserted row. The admin inbox client uses
  // the returned `message` to optimistically append, so admin replies
  // appear in the thread immediately without waiting for the realtime
  // INSERT echo (same UX fix as the user-facing chat).
  const { data: inserted, error: insertErr } = await supabase
    .from('chat_messages')
    .insert({
      room_id: roomId,
      sender_id: user.id,
      content: trimmed,
      is_admin_sender: true,
    })
    .select('id, room_id, sender_id, content, is_admin_sender, created_at')
    .single()
  if (insertErr || !inserted) {
    return NextResponse.json({ error: insertErr?.message ?? 'insert failed' }, { status: 500 })
  }

  // Sending an admin reply implicitly marks the room as read by this
  // admin — the message we just sent is by definition newer than any
  // unread user message they were responding to.
  await supabase
    .from('chat_room_state')
    .upsert({
      room_id: roomId,
      last_admin_read_at: new Date().toISOString(),
      // status preserved if already set (closed rooms stay closed
      // unless explicitly reopened — though the auto-reopen trigger
      // on chat_messages handles user-driven reopens).
    }, { onConflict: 'room_id' })

  return NextResponse.json({ ok: true, message: inserted })
}
