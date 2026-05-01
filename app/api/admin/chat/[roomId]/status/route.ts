/**
 * POST /api/admin/chat/[roomId]/status
 *
 * Body: { status: 'open' | 'closed' }
 *
 * Closes or reopens a conversation. Closed conversations stay
 * visible in the admin inbox under the "Closed" filter. If the user
 * sends a new message into a closed room, the migration 034 trigger
 * automatically flips status back to 'open' so the admin sees the
 * fresh message instead of it disappearing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
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

  const body = await req.json().catch(() => null)
  const status: unknown = body?.status
  if (status !== 'open' && status !== 'closed') {
    return NextResponse.json({ error: 'status must be "open" or "closed"' }, { status: 400 })
  }

  const update: Record<string, unknown> = {
    room_id: roomId,
    status,
  }
  if (status === 'closed') {
    update.closed_at = new Date().toISOString()
    update.closed_by = user.id
  } else {
    update.closed_at = null
    update.closed_by = null
  }

  const { error } = await supabase
    .from('chat_room_state')
    .upsert(update, { onConflict: 'room_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
