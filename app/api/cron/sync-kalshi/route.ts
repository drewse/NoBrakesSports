import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchKalshiMarkets, kalshiPriceToProb } from '@/lib/data-sync/kalshi'

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
    .eq('slug', 'kalshi')
    .single()

  if (!source) {
    return NextResponse.json({ error: 'Kalshi source not found in DB' }, { status: 500 })
  }

  let fetchResult
  try {
    fetchResult = await fetchKalshiMarkets()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const { markets, debug } = fetchResult

  const { data: events } = await db
    .from('events')
    .select('id, title')
    .eq('status', 'scheduled')

  const now = new Date().toISOString()
  const snapshots: object[] = []

  for (const market of markets) {
    const yesProb = kalshiPriceToProb(market, 'yes')
    const noProb = kalshiPriceToProb(market, 'no')

    const titleWords = market.title.toLowerCase().split(/\s+/)
    const matchedEvent = events?.find(e => {
      const eventWords = e.title.toLowerCase().split(/\s+/)
      const overlap = titleWords.filter((w: string) => w.length > 3 && eventWords.includes(w))
      return overlap.length >= 2
    })

    snapshots.push({
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
    .eq('slug', 'kalshi')

  return NextResponse.json({
    ok: true,
    marketsFound: snapshots.length,
    marketsInserted: inserted,
    debug,
    errors: errors.length ? errors : undefined,
  })
}
