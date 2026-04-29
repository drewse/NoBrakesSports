/**
 * POST /api/affiliate — create the signed-in user's affiliate row.
 *
 * Body: { code: string }
 * Returns 201 with the new row, or 4xx with { error: string }.
 *
 * Validation runs on this server route AND in the DB (CHECK constraint),
 * so a forged client request can't slip through a malformed code.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sanitizeAffiliateCode,
  validateAffiliateCode,
} from '@/lib/affiliate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const code = sanitizeAffiliateCode(String(body?.code ?? ''))
  const err = validateAffiliateCode(code)
  if (err) return NextResponse.json({ error: err }, { status: 400 })

  // Reject early if this user already has an affiliate row, with a clearer
  // message than the unique-constraint error.
  const { data: existing } = await supabase
    .from('affiliates')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: 'You already have an affiliate code.' },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('affiliates')
    .insert({
      user_id: user.id,
      code,
      email: user.email ?? '',
      type: 'affiliate',
      status: 'active',
    })
    .select('*')
    .single()

  if (error) {
    // 23505 = unique_violation; most likely the code is taken.
    if ((error as any).code === '23505') {
      return NextResponse.json(
        { error: 'That code is already taken. Try another.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ affiliate: data }, { status: 201 })
}
