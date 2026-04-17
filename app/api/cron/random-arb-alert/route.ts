// Every 15 minutes: pick a random arb (0-5% profit) and post to Discord
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

function toImplied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100)
}

function formatOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

interface ArbCandidate {
  eventTitle: string
  market: string
  league: string
  sideA: { label: string; price: number; source: string }
  sideB: { label: string; price: number; source: string }
  profitPct: number
  type: 'game' | 'prop'
}

export async function GET(req: NextRequest) {
  // Allow: Vercel cron, Authorization header with CRON_SECRET, or ?key= query param
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  const isVercelCron = req.headers.get('user-agent')?.includes('vercel-cron')
  const url = new URL(req.url)
  const queryKey = url.searchParams.get('key')
  const authorized =
    isVercelCron ||
    !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    queryKey === cronSecret
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!WEBHOOK_URL) {
    return NextResponse.json({ error: 'DISCORD_WEBHOOK_URL not set' }, { status: 500 })
  }

  const db = createAdminClient()
  const staleCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
  const arbs: ArbCandidate[] = []

  // ── Game-level ML arbs ──
  const { data: mlRows } = await db
    .from('current_market_odds')
    .select(`
      event_id, source_id, home_price, away_price,
      event:events(title, start_time, league:leagues(abbreviation)),
      source:market_sources(slug, name)
    `)
    .eq('market_type', 'moneyline')
    .gt('snapshot_time', staleCutoff)
    .not('home_price', 'is', null)
    .not('away_price', 'is', null)
    .limit(2000)

  const mlByEvent = new Map<string, any[]>()
  for (const row of mlRows ?? []) {
    const ev = (row as any).event
    if (!ev || new Date(ev.start_time) < new Date()) continue
    if (!mlByEvent.has(row.event_id)) mlByEvent.set(row.event_id, [])
    mlByEvent.get(row.event_id)!.push(row)
  }

  for (const [, rows] of mlByEvent) {
    if (rows.length < 2) continue
    const ev = (rows[0] as any).event
    const bestHome = rows.reduce((a: any, b: any) => b.home_price > a.home_price ? b : a)
    const bestAway = rows.reduce((a: any, b: any) => b.away_price > a.away_price ? b : a)
    if ((bestHome as any).source_id === (bestAway as any).source_id) continue

    const combined = toImplied(bestHome.home_price) + toImplied(bestAway.away_price)
    const profit = (1 / combined - 1) * 100
    if (profit < 0 || profit > 5) continue

    arbs.push({
      eventTitle: ev.title,
      market: 'Moneyline',
      league: ev.league?.abbreviation ?? '—',
      sideA: { label: 'Home', price: bestHome.home_price, source: (bestHome as any).source?.name ?? '—' },
      sideB: { label: 'Away', price: bestAway.away_price, source: (bestAway as any).source?.name ?? '—' },
      profitPct: profit,
      type: 'game',
    })
  }

  // ── Prop arbs ──
  // Paginate since prop_odds can exceed 1000 rows
  const allProps: any[] = []
  for (let off = 0; off < 20000; off += 1000) {
    const { data: batch } = await db
      .from('prop_odds')
      .select(`
        event_id, source_id, prop_category, player_name, line_value,
        over_price, under_price,
        event:events(title, start_time, league:leagues(abbreviation)),
        source:market_sources(slug, name)
      `)
      .gt('snapshot_time', staleCutoff)
      .or('over_price.not.is.null,under_price.not.is.null')
      .range(off, off + 999)
    if (!batch || batch.length === 0) break
    allProps.push(...batch)
  }

  const propGroups = new Map<string, any[]>()
  for (const p of allProps) {
    const ev = (p as any).event
    if (!ev || new Date(ev.start_time) < new Date()) continue
    const key = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}`
    if (!propGroups.has(key)) propGroups.set(key, [])
    propGroups.get(key)!.push(p)
  }

  for (const [key, books] of propGroups) {
    if (books.length < 2) continue
    const withOver = books.filter((b: any) => b.over_price != null)
    const withUnder = books.filter((b: any) => b.under_price != null)
    if (withOver.length === 0 || withUnder.length === 0) continue

    const bestOver = withOver.reduce((a: any, b: any) => b.over_price > a.over_price ? b : a)
    const bestUnder = withUnder.reduce((a: any, b: any) => b.under_price > a.under_price ? b : a)
    if ((bestOver as any).source_id === (bestUnder as any).source_id) continue

    const combined = toImplied(bestOver.over_price) + toImplied(bestUnder.under_price)
    const profit = (1 / combined - 1) * 100
    if (profit < 0 || profit > 5) continue

    const [, category, player, line] = key.split('|')
    const ev = (bestOver as any).event

    arbs.push({
      eventTitle: ev.title,
      market: `${player} ${category.replace('player_', '').replace(/_/g, ' ')} ${line}`,
      league: ev.league?.abbreviation ?? '—',
      sideA: { label: 'Over', price: bestOver.over_price, source: (bestOver as any).source?.name ?? '—' },
      sideB: { label: 'Under', price: bestUnder.under_price, source: (bestUnder as any).source?.name ?? '—' },
      profitPct: profit,
      type: 'prop',
    })
  }

  if (arbs.length === 0) {
    return NextResponse.json({ ok: true, picked: 0, candidates: 0 })
  }

  // Pick a random one
  const pick = arbs[Math.floor(Math.random() * arbs.length)]

  // Send to Discord
  const emoji = pick.profitPct >= 2 ? '🔥' : pick.profitPct >= 1 ? '💰' : '💎'
  const color = pick.profitPct >= 2 ? 0x00ff88 : pick.profitPct >= 1 ? 0xffd700 : 0x88ccff

  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `${emoji} Arb: ${pick.profitPct.toFixed(2)}% Profit`,
        color,
        fields: [
          { name: 'Event', value: pick.eventTitle, inline: false },
          { name: 'Market', value: pick.market, inline: false },
          { name: pick.sideA.label, value: `**${formatOdds(pick.sideA.price)}** @ ${pick.sideA.source}`, inline: true },
          { name: pick.sideB.label, value: `**${formatOdds(pick.sideB.price)}** @ ${pick.sideB.source}`, inline: true },
          { name: 'Profit', value: `**${pick.profitPct.toFixed(2)}%**`, inline: true },
        ],
        footer: { text: `${pick.type === 'prop' ? 'Prop' : 'Game'} • ${pick.league} • ${arbs.length} total arbs (0-5%)` },
        timestamp: new Date().toISOString(),
      }],
    }),
  })

  return NextResponse.json({
    ok: true,
    picked: pick,
    totalCandidates: arbs.length,
  })
}
