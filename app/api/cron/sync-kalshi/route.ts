import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKalshiMarkets, kalshiPriceToProb } from '@/lib/data-sync/kalshi'

export const runtime = 'nodejs'
export const maxDuration = 30

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  return (
    secret === process.env.CRON_SECRET ||
    secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Get Kalshi source ID
  const { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', 'kalshi')
    .single()

  if (!source) {
    return NextResponse.json({ error: 'Kalshi source not found in DB' }, { status: 500 })
  }

  let markets
  try {
    markets = await fetchKalshiMarkets()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // Load all events for matching by title
  const { data: events } = await db
    .from('events')
    .select('id, title')
    .eq('status', 'scheduled')

  const now = new Date().toISOString()
  let inserted = 0
  const errors: string[] = []

  for (const market of markets) {
    const yesProb = kalshiPriceToProb(market.yes_bid)
    const noProb = kalshiPriceToProb(market.no_bid)

    // Try to find a matching event by keyword overlap
    const titleWords = market.title.toLowerCase().split(/\s+/)
    const matchedEvent = events?.find(e => {
      const eventWords = e.title.toLowerCase().split(/\s+/)
      const overlap = titleWords.filter(w => w.length > 3 && eventWords.includes(w))
      return overlap.length >= 2
    })

    const { error } = await db.from('prediction_market_snapshots').insert({
      event_id: matchedEvent?.id ?? null,
      source_id: source.id,
      contract_title: market.title,
      external_contract_id: market.ticker,
      yes_price: yesProb,
      no_price: noProb,
      total_volume: market.volume,
      open_interest: market.open_interest,
      snapshot_time: now,
    })

    if (error) {
      errors.push(`${market.ticker}: ${error.message}`)
    } else {
      inserted++
    }
  }

  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now })
    .eq('slug', 'kalshi')

  return NextResponse.json({ ok: true, marketsInserted: inserted, errors: errors.length ? errors : undefined })
}
