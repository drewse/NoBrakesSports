import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPolymarketEvents, parsePolymarketPrices } from '@/lib/data-sync/polymarket'

export const runtime = 'nodejs'
export const maxDuration = 30

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  return secret === process.env.CRON_SECRET
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  const { data: source } = await db
    .from('market_sources')
    .select('id')
    .eq('slug', 'polymarket')
    .single()

  if (!source) {
    return NextResponse.json({ error: 'Polymarket source not found in DB' }, { status: 500 })
  }

  let polyEvents
  try {
    polyEvents = await fetchPolymarketEvents()
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  const { data: dbEvents } = await db
    .from('events')
    .select('id, title')
    .eq('status', 'scheduled')

  const now = new Date().toISOString()
  let inserted = 0
  const errors: string[] = []

  for (const polyEvent of polyEvents) {
    for (const market of polyEvent.markets) {
      if (!market.active || market.closed) continue

      const prices = parsePolymarketPrices(market)
      if (!prices) continue

      // Match to internal event by keyword overlap
      const question = market.question.toLowerCase()
      const matchedEvent = dbEvents?.find(e => {
        const words = e.title.toLowerCase().split(/\s+/)
        return words.some((w: string) => w.length > 4 && question.includes(w))
      })

      const volume = parseFloat(market.volume ?? '0')

      const { error } = await db.from('prediction_market_snapshots').insert({
        event_id: matchedEvent?.id ?? null,
        source_id: source.id,
        contract_title: market.question,
        external_contract_id: market.conditionId,
        yes_price: prices.yes,
        no_price: prices.no,
        total_volume: isNaN(volume) ? null : volume,
        snapshot_time: now,
      })

      if (error) {
        errors.push(`${market.conditionId}: ${error.message}`)
      } else {
        inserted++
      }
    }
  }

  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now })
    .eq('slug', 'polymarket')

  return NextResponse.json({ ok: true, marketsInserted: inserted, errors: errors.length ? errors : undefined })
}
