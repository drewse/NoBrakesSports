/** /api/arbitrage — JSON endpoint backing the arbitrage page's live polling. */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { loadArbs } from '@/lib/arbitrage/loaders'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  const t0 = Date.now()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)

  // Pull tier in parallel with the arb load so the log line can
  // attribute load to free vs pro without adding a sequential round-trip.
  const [profileRes, result] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', user.id)
      .single(),
    loadArbs(supabase as any, enabledBooks),
  ])
  const isPro =
    profileRes.data?.subscription_tier === 'pro' &&
    profileRes.data?.subscription_status === 'active'

  // One structured log line per request. Vercel/Railway log viewers
  // ingest this cleanly and grep `[api.arbitrage]` to slice. No user
  // id or email — only opaque tier — so this is safe in shared logs.
  console.log(
    `[api.arbitrage] tier=${isPro ? 'pro' : 'free'} arbs=${result.totalArbs} books=${result.uniqueBooks} ms=${Date.now() - t0}`,
  )

  return NextResponse.json(result)
}
