/**
 * POST /api/admin/chat/[roomId]/read
 *
 * Marks the conversation as read by the admin (sets
 * last_admin_read_at = NOW). The inbox UI computes "unread" and
 * "needs response" against this timestamp.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await params
  if (!roomId) return NextResponse.json({ error: 'roomId required' }, { status: 400 })

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

  const { error } = await supabase
    .from('chat_room_state')
    .upsert({
      room_id: roomId,
      last_admin_read_at: new Date().toISOString(),
    }, { onConflict: 'room_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
