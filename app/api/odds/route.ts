/**
 * /api/odds — JSON endpoint backing the /odds page's live polling.
 *
 * Same loaders the SSR page uses; the only difference is the response
 * format (plain JSON, no React Server Component streaming). All filter
 * state is encoded in the same query params as the page URL, so the
 * client can build a polling URL by mirroring window.location.search.
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { loadGameOdds, loadPropOdds } from '@/lib/odds/loaders'
import { selectionFromParams, planForSelection } from '@/lib/odds/market-key'
import { timeRangeFromParam } from '@/lib/odds/time-range'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params: Record<string, string | undefined> = {}
  req.nextUrl.searchParams.forEach((v, k) => { params[k] = v })

  const selection = selectionFromParams(params)
  const plan = planForSelection(selection)
  const within = timeRangeFromParam(params.within)

  // Read the user's enabled-books selection from the topbar selector
  // cookie. When set, the loader forces every enabled book to appear
  // as a column even if it has no data — coverage diagnostic. When
  // unset (null), the loader behaves as before (only books with data).
  const cookieStore = await cookies()
  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooks = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)

  if (!plan) {
    return NextResponse.json({ payload: null })
  }

  const payload = plan.table === 'prop_odds'
    ? await loadPropOdds(supabase as any, selection, plan, within, enabledBooks)
    : await loadGameOdds(supabase as any, selection, plan, within, enabledBooks)

  return NextResponse.json({ payload })
}
