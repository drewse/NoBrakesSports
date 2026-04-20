// Every 15 minutes: pick a random +EV line (3–8% edge) and post to Discord.
// Uses a dedicated webhook (DISCORD_EV_WEBHOOK_URL) — falls back to the main
// webhook if the dedicated one isn't configured.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

const WEBHOOK_URL = process.env.DISCORD_EV_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK_URL

function americanToImplied(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100)
}

function americanToDecimal(odds: number): number {
  return odds > 0 ? odds / 100 + 1 : 100 / Math.abs(odds) + 1
}

function formatOdds(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}

/** Power-devig: normalize implied probs to sum to 1 using a bisection k-solver */
function powerDevig(probs: number[]): number[] {
  let lo = 0.01, hi = 10.0
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    const sum = probs.reduce((acc, p) => acc + Math.pow(p, 1 / mid), 0)
    if (sum > 1.0) hi = mid; else lo = mid
  }
  const k = (lo + hi) / 2
  const fair = probs.map(p => Math.pow(p, 1 / k))
  const total = fair.reduce((a, b) => a + b, 0)
  return fair.map(p => p / total)
}

interface EvCandidate {
  eventTitle: string
  outcome: string
  league: string
  price: number
  source: string
  evPct: number
  fairProb: number
  type: 'game' | 'prop'
}

export async function GET(req: NextRequest) {
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
    return NextResponse.json({
      error: 'Neither DISCORD_EV_WEBHOOK_URL nor DISCORD_WEBHOOK_URL is set',
    }, { status: 500 })
  }

  const db = createAdminClient()
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const candidates: EvCandidate[] = []

  // ── Game-level Moneyline EV ──
  const { data: mlRows } = await db
    .from('current_market_odds')
    .select(`
      event_id, source_id, home_price, away_price, draw_price,
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

    // Fair probability: Pinnacle-first, else weighted consensus
    const pin = rows.find((r: any) => r.source?.slug === 'pinnacle')
    let fairHome: number, fairAway: number
    if (pin) {
      const h = americanToImplied(pin.home_price)
      const a = americanToImplied(pin.away_price)
      const fair = powerDevig([h, a])
      fairHome = fair[0]
      fairAway = fair[1]
    } else {
      let wH = 0, wA = 0, wT = 0
      for (const r of rows) {
        const h = americanToImplied(r.home_price)
        const a = americanToImplied(r.away_price)
        const overround = h + a
        if (overround > 1.10) continue
        const fair = powerDevig([h, a])
        const w = 1 / overround
        wH += w * fair[0]
        wA += w * fair[1]
        wT += w
      }
      if (wT === 0) continue
      fairHome = wH / wT
      fairAway = wA / wT
    }

    for (const r of rows) {
      if (r.source?.slug === 'pinnacle') continue // don't alert Pinnacle's own line
      const homeEv = (fairHome * americanToDecimal(r.home_price) - 1) * 100
      const awayEv = (fairAway * americanToDecimal(r.away_price) - 1) * 100
      for (const [side, evPct, price, fair] of [
        ['Home', homeEv, r.home_price, fairHome],
        ['Away', awayEv, r.away_price, fairAway],
      ] as const) {
        if (!isFinite(evPct)) continue
        if (evPct < 3 || evPct > 8) continue
        candidates.push({
          eventTitle: ev.title,
          outcome: `${side} ML`,
          league: ev.league?.abbreviation ?? '—',
          price, source: r.source?.name ?? '—',
          evPct, fairProb: fair,
          type: 'game',
        })
      }
    }
  }

  // ── Prop EV — paginate since prop_odds exceeds 1000 rows ──
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

  // Group by (event, category, player, line)
  const propGroups = new Map<string, any[]>()
  for (const p of allProps) {
    const ev = (p as any).event
    if (!ev || new Date(ev.start_time) < new Date()) continue
    const key = `${p.event_id}|${p.prop_category}|${p.player_name}|${p.line_value}`
    if (!propGroups.has(key)) propGroups.set(key, [])
    propGroups.get(key)!.push(p)
  }

  for (const [key, books] of propGroups) {
    const twoSided = books.filter((b: any) => b.over_price != null && b.under_price != null)
    if (twoSided.length === 0) continue

    // Find best-balanced (sharpest) book for fair prob
    let bestBalance = Infinity
    let fairOver = 0.5, fairUnder = 0.5
    for (const b of twoSided) {
      const o = americanToImplied(b.over_price)
      const u = americanToImplied(b.under_price)
      const balance = Math.abs(o - u)
      if (balance < bestBalance) {
        bestBalance = balance
        const fair = powerDevig([o, u])
        fairOver = fair[0]
        fairUnder = fair[1]
      }
    }

    const [, category, player, line] = key.split('|')
    const ev = (books[0] as any).event

    for (const b of books) {
      for (const [side, price, fair] of [
        ['Over', b.over_price, fairOver],
        ['Under', b.under_price, fairUnder],
      ] as const) {
        if (price == null) continue
        const evPct = (fair * americanToDecimal(price) - 1) * 100
        if (!isFinite(evPct)) continue
        if (evPct < 3 || evPct > 8) continue
        candidates.push({
          eventTitle: ev.title,
          outcome: `${player} ${category.replace('player_', '').replace(/_/g, ' ')} ${side} ${line}`,
          league: ev.league?.abbreviation ?? '—',
          price, source: b.source?.name ?? '—',
          evPct, fairProb: fair,
          type: 'prop',
        })
      }
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, picked: 0, candidates: 0 })
  }

  // Random pick
  const pick = candidates[Math.floor(Math.random() * candidates.length)]

  const emoji = pick.evPct >= 6 ? '🔥' : pick.evPct >= 4.5 ? '⚡' : '💎'
  const color = pick.evPct >= 6 ? 0xffd700 : pick.evPct >= 4.5 ? 0x00ff88 : 0x88ccff

  await fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `${emoji} +EV: ${pick.evPct.toFixed(2)}% Edge`,
        color,
        fields: [
          { name: 'Event', value: pick.eventTitle, inline: false },
          { name: 'Outcome', value: pick.outcome, inline: false },
          { name: 'Best Price', value: `**${formatOdds(pick.price)}** @ ${pick.source}`, inline: true },
          { name: 'EV %', value: `**+${pick.evPct.toFixed(2)}%**`, inline: true },
          { name: 'Fair Prob', value: `${(pick.fairProb * 100).toFixed(1)}%`, inline: true },
        ],
        footer: { text: `${pick.type === 'prop' ? 'Prop' : 'Game'} • ${pick.league} • ${candidates.length} total +EV (3-8%)` },
        timestamp: new Date().toISOString(),
      }],
    }),
  })

  return NextResponse.json({
    ok: true,
    picked: pick,
    totalCandidates: candidates.length,
  })
}
