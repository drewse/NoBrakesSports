/** /api/ev — JSON endpoint backing /top-lines (+EV) live polling. */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { loadEv } from '@/lib/ev/loaders'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const t0 = Date.now()
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)

  const league = req.nextUrl.searchParams.get('league') ?? 'all'
  const market = req.nextUrl.searchParams.get('market') ?? 'all'

  // Run profile lookup + EV computation in parallel. The profile
  // result only feeds the final visibility slice (free vs pro);
  // loadEv doesn't depend on it for the heavy work. Saves ~100ms
  // per poll on a 10s polling interval.
  const [profileRes, result] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, subscription_status')
      .eq('id', user.id)
      .single(),
    // Optimistically request the full result; we trim below when
    // the user turns out to be free-tier.
    loadEv(supabase as any, enabledBooks, { league, market }, { isPro: true }),
  ])
  const profile = profileRes.data
  const isPro =
    profile?.subscription_tier === 'pro' &&
    profile?.subscription_status === 'active'

  // Free-tier slice: same 10-line cap loadEv applies internally when
  // isPro=false. Done here so we don't re-run loadEv when the
  // tier check resolves second.
  const finalLines = !isPro && result.lines.length > 10
    ? result.lines.slice(0, 10)
    : result.lines

  // One structured log line per request — production-safe (no PII),
  // grep `[api.ev]` to slice. `lines` is the post-tier-slice count
  // the user actually receives; `events` is the upstream cardinality.
  console.log(
    `[api.ev] tier=${isPro ? 'pro' : 'free'} league=${league} market=${market} lines=${finalLines.length} events=${result.totalEvents} ms=${Date.now() - t0}`,
  )

  if (finalLines !== result.lines) {
    return NextResponse.json({ ...result, lines: finalLines })
  }
  return NextResponse.json(result)
}
