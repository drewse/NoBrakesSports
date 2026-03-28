import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchPolymarketEvents, parsePolymarketPrices } from '@/lib/data-sync/polymarket'

export const runtime = 'nodejs'
export const maxDuration = 60

function verifyCron(request: NextRequest) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
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
  const snapshots: object[] = []

  for (const polyEvent of polyEvents) {
    for (const market of polyEvent.markets ?? []) {
      if (!market.active || market.closed) continue

      const prices = parsePolymarketPrices(market)
      if (!prices) continue

      const question = market.question.toLowerCase()
      const matchedEvent = dbEvents?.find(e => {
        const words = e.title.toLowerCase().split(/\s+/)
        return words.some((w: string) => w.length > 4 && question.includes(w))
      })

      const volume = parseFloat(market.volume ?? '0')

      snapshots.push({
        event_id: matchedEvent?.id ?? null,
        source_id: source.id,
        contract_title: market.question,
        external_contract_id: market.conditionId,
        yes_price: prices.yes,
        no_price: prices.no,
        total_volume: isNaN(volume) ? null : volume,
        snapshot_time: now,
      })
    }
  }

  // Bulk insert in chunks of 200
  let inserted = 0
  const errors: string[] = []
  const chunkSize = 200
  for (let i = 0; i < snapshots.length; i += chunkSize) {
    const { error } = await db
      .from('prediction_market_snapshots')
      .insert(snapshots.slice(i, i + chunkSize))
    if (error) {
      errors.push(`Batch ${Math.floor(i / chunkSize)}: ${error.message}`)
    } else {
      inserted += Math.min(chunkSize, snapshots.length - i)
    }
  }

  await db
    .from('market_sources')
    .update({ health_status: 'healthy', last_health_check: now })
    .eq('slug', 'polymarket')

  return NextResponse.json({
    ok: true,
    marketsFound: snapshots.length,
    marketsInserted: inserted,
    errors: errors.length ? errors : undefined,
  })
}
