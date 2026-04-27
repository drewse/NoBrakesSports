/**
 * /api/odds — JSON endpoint backing the /odds page's live polling.
 *
 * Same loaders the SSR page uses; the only difference is the response
 * format (plain JSON, no React Server Component streaming). All filter
 * state is encoded in the same query params as the page URL, so the
 * client can build a polling URL by mirroring window.location.search.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadGameOdds, loadPropOdds } from '@/lib/odds/loaders'
import { selectionFromParams, planForSelection } from '@/lib/odds/market-key'
import { timeRangeFromParam } from '@/lib/odds/time-range'

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

  if (!plan) {
    return NextResponse.json({ payload: null })
  }

  const payload = plan.table === 'prop_odds'
    ? await loadPropOdds(supabase as any, selection, plan, within)
    : await loadGameOdds(supabase as any, selection, plan, within)

  return NextResponse.json({ payload })
}
