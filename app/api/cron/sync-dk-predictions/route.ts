// GET /api/cron/sync-dk-predictions
//
// DraftKings Predictions sync.
//
// Endpoint:
//   POST https://api.draftkings.com/en/predict/v1/polling/clients/web/markets
//   body: { marketTickers: string[], languageCode: 'en' }
//   origin: https://predictions.draftkings.com
//
// Response shape (verified 2026-04-25):
//   {
//     "markets": {
//       "<ticker>": {
//         "ticker": "...", "volume": <num>, "lastPrice": <num>,
//         "details": {
//           "binary": {
//             "yesAsk": <0-100>, "yesBid": <0-100>,
//             "noAsk":  <0-100>, "noBid":  <0-100>,
//             "hasYesAskOffers": <bool>, "hasYesBidOffers": <bool>,
//             "hasNoAskOffers":  <bool>, "hasNoBidOffers":  <bool>
//           }
//         }
//       }, ...
//     },
//     "exchange": { "status": "Open" }
//   }
//
// Pricing convention:
//   yes_price = (yesBid + yesAsk) / 200      // cents → 0..1 probability
//   no_price  = (noBid  + noAsk)  / 200
//   Skip markets where both bid and ask are 0 on at least one side.
//
// Ticker discovery:
//   We don't yet have the URL DK uses to list today's tickers — the
//   captured curl arrived with the list inlined. Until we identify it,
//   tickers come from DK_PREDICTIONS_TICKERS in env (newline-or-comma
//   separated) with a small built-in seed for first run. Ticker shape:
//     DKP3-SP{LEAGUE}GL{TYPE}{MARKET_ID}-{OUTCOME_ID}   game lines
//     DKP2-NSZ2AMR2VXDTDA-{TEAM_ABBR}M0001              NBA Finals winner
//     DKP3-SP{LEAGUE}TFEC{TOURNAMENT_ID}-{OUTCOME_ID}   conf champion etc.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

const POLL_URL = 'https://api.draftkings.com/en/predict/v1/polling/clients/web/markets'

const HEADERS: Record<string, string> = {
  Accept:           'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type':   'application/json',
  Origin:           'https://predictions.draftkings.com',
  Referer:          'https://predictions.draftkings.com/',
  'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
}

// Seed ticker list captured from a real DevTools session 2026-04-25.
// Mostly current-day NBA game lines (ML/SPR/TP) + NBA Finals winner +
// Eastern/Western Conference champion futures. These will go stale as
// games finish — refresh from DK_PREDICTIONS_TICKERS env (one ticker
// per line or comma-separated) until we find the listing endpoint.
const SEED_TICKERS = [
  // NBA game lines (today)
  'DKP3-SPNBAGLMLXAL4CJWM7HAFG-WXAL4CJWXV89WT',
  'DKP3-SPNBAGLMLXAL4CJWM7HAFG-WXAL4CJWYX62JO',
  'DKP3-SPNBAGLSPRXALFUE8JS2N97FG-W-11.5XALFUE8O91PVK',
  'DKP3-SPNBAGLTPXALFUKNJUWZBFG-O209.5XALFUKNQHAN47',
  'DKP3-SPNBAGLMLXAL4CJX03C851FG-WXAL4CJXB18HWO',
  'DKP3-SPNBAGLMLXAL4CJX03C851FG-WXAL4CJXC33MT',
  'DKP3-SPNBAGLSPRXALG0TS2K5I4TFG-W-1.5XALG0TSLM3NVH',
  'DKP3-SPNBAGLTPXALG10B5RHS4EFG-O229.5XALG10BDZL5EY',
  'DKP3-SPNBAGLMLXAL4IZB9KCPHBFG-WXAL4IZBQAGW4Q',
  'DKP3-SPNBAGLMLXAL4IZB9KCPHBFG-WXAL4IZBRIF199',
  'DKP3-SPNBAGLSPRXALFWJE927750FG-W-3.5XALFWJEH544G5',
  'DKP3-SPNBAGLTPXALFWPX43AXNZFG-O220.5XALFWPXBT79A5',
  'DKP3-SPNBAGLMLXAL4IZBSKE40PFG-WXAL4IZC247KOQ',
  'DKP3-SPNBAGLMLXAL4IZBSKE40PFG-WXAL4IZC376YYG',
  'DKP3-SPNBAGLSPRXALHIEQF86NZ4FG-W-5.5XALHIEQNGDU4P',
  'DKP3-SPNBAGLTPXALHIL648BFE8FG-O218.5XALHIL6BVES21',
  'DKP3-SPNBAGLMLXAL4IZC49I23FG-WXAL4IZCEH4OXI',
  'DKP3-SPNBAGLMLXAL4IZC49I23FG-WXAL4IZCFHFC3J',
  'DKP3-SPNBAGLSPRXALH9U68JJ4SJFG-W-7.5XALH9U6GVLCWI',
  'DKP3-SPNBAGLTPXALHA0L205738FG-O213.5XALHA0LA41KTL',
  'DKP3-SPNBAGLMLXAL4IZCGMKUUYFG-WXAL4IZCSF4TBZ',
  'DKP3-SPNBAGLMLXAL4IZCGMKUUYFG-WXAL4IZCTIJFBY',
  'DKP3-SPNBAGLSPRXALHBZBR98917FG-W-4.5XALHBZCBPK5OF',
  'DKP3-SPNBAGLTPXALHC5QO7E4IXFG-O207.5XALHC5QVMF9ZF',
  'DKP3-SPNBAGLMLXALBSGY5N16LMFG-WXALBSGYINEM9T',
  'DKP3-SPNBAGLMLXALBSGY5N16LMFG-WXALBSGYHB8QGO',
  'DKP3-SPNBAGLSPRXALICEZMH93NDFG-W-3.5XALICEZUK5M7Z',
  'DKP3-SPNBAGLTPXALICLEROC2N0FG-O202.5XALICLEYBHR1D',
  'DKP3-SPNBAGLMLXALBSGYJYFR85FG-WXALBSGYY282GT',
  'DKP3-SPNBAGLMLXALBSGYJYFR85FG-WXALBSGYZ6JCON',
  'DKP3-SPNBAGLSPRXALIIUJDS7J4NFG-W-26.5XALIIUJG3ANC0',
  'DKP3-SPNBAGLTPXALIJ0YGFBMSNFG-O188.5XALIJ0YIS7BIB',
  // NBA Finals winner futures
  'DKP2-NSZ2AMR2VXDTDA-OKCM0001',
  'DKP2-NSZ2AMR2VXDTDA-SASM0001',
  'DKP2-NSZ2AMR2VXDTDA-BOSM0001',
  'DKP2-NSZ2AMR2VXDTDA-CLEM0001',
  'DKP2-NSZ2AMR2VXDTDA-DENM0001',
  'DKP2-NSZ2AMR2VXDTDA-PHIM0001',
  'DKP2-NSZ2AMR2VXDTDA-ORLM0001',
  'DKP2-NSZ2AMR2VXDTDA-ATLM0001',
  'DKP2-NSZ2AMR2VXDTDA-TORM0001',
  // Eastern Conference winner
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMEGN',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMBSZ',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMLJZ',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMTIV',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMG59',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMNDB',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKM5OC',
  'DKP3-SPNBATFECWXAFGKLZB5P-XAFGKMVDB',
  // Western Conference winner
  'DKP3-SPNBATFWCWXAFGNDK4YP-XAFGNEAGI',
]

function loadTickers(): string[] {
  const env = process.env.DK_PREDICTIONS_TICKERS
  if (!env) return SEED_TICKERS
  const parsed = env.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
  return parsed.length > 0 ? parsed : SEED_TICKERS
}

function verifyCron(request: NextRequest): boolean {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return (
    secret === process.env.CRON_SECRET ||
    secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
}

interface BinaryDetails {
  yesAsk: number; yesBid: number
  noAsk:  number; noBid:  number
  hasYesAskOffers?: boolean; hasYesBidOffers?: boolean
  hasNoAskOffers?:  boolean; hasNoBidOffers?:  boolean
}

interface PolledMarket {
  ticker: string
  volume: number
  lastPrice: number
  details?: { binary?: BinaryDetails }
}

interface PolledResponse {
  markets?: Record<string, PolledMarket>
  exchange?: { status: string }
}

interface SnapshotRow {
  ticker: string
  yesProb: number
  noProb:  number
  volume:  number
}

/** Convert one polled market to a snapshot row. Returns null when no
 *  meaningful price exists (both yes sides 0, or both no sides 0). */
function rowFor(market: PolledMarket): SnapshotRow | null {
  const b = market?.details?.binary
  if (!b) return null
  const { yesBid, yesAsk, noBid, noAsk } = b
  if (yesBid === 0 && yesAsk === 0) return null
  if (noBid  === 0 && noAsk  === 0) return null
  // Mid-market price in cents → 0..1 probability.
  const yesProb = (yesBid + yesAsk) / 200
  const noProb  = (noBid  + noAsk)  / 200
  if (!isFinite(yesProb) || !isFinite(noProb)) return null
  return {
    ticker:  market.ticker,
    yesProb: Math.round(yesProb * 10000) / 10000,
    noProb:  Math.round(noProb  * 10000) / 10000,
    volume:  market.volume ?? 0,
  }
}

/** Decode a ticker into a human-readable contract title. The ticker
 *  encodes meaning (league, market type, outcome key) but not team
 *  names, so the best we can do without a separate metadata fetch is
 *  the structural label. We log the bare ticker as a fallback so the
 *  row is still useful for join/diff downstream. */
function titleFor(ticker: string): string {
  // Game line — moneyline / spread / total
  const gl = ticker.match(/^DKP3-SP([A-Z]+)GL(ML|SPR|TP)([A-Z0-9]+)-(.+)$/)
  if (gl) {
    const [, league, kind] = gl
    const human =
      kind === 'ML'  ? 'Moneyline' :
      kind === 'SPR' ? 'Spread' :
      kind === 'TP'  ? 'Total Points' : kind
    return `${league} ${human} · ${ticker}`
  }
  // Tournament — eastern / western champ etc.
  const tf = ticker.match(/^DKP3-SP([A-Z]+)TF([A-Z]+)CW([A-Z0-9]+)-([A-Z0-9]+)$/)
  if (tf) {
    const [, league, suffix] = tf
    const human =
      suffix === 'EC' ? 'Eastern Conference Winner' :
      suffix === 'WC' ? 'Western Conference Winner' :
      `${suffix} Winner`
    return `${league} ${human} · ${ticker}`
  }
  // NBA Finals futures (DKP2-…-{TEAM}M0001)
  const fin = ticker.match(/^DKP2-[A-Z0-9]+-([A-Z]{2,3})M\d+$/)
  if (fin) {
    const [, team] = fin
    return `NBA Finals Winner · ${team} · ${ticker}`
  }
  return ticker
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tickers = loadTickers()
  const start = Date.now()

  let resp: Response
  try {
    resp = await fetch(POLL_URL, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify({ marketTickers: tickers, languageCode: 'en' }),
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false, stage: 'fetch',
      error: e?.message ?? String(e),
      elapsedMs: Date.now() - start,
    })
  }
  if (!resp.ok) {
    const text = await resp.text()
    return NextResponse.json({
      ok: false, stage: 'http',
      httpStatus: resp.status,
      preview:    text.slice(0, 400),
      elapsedMs:  Date.now() - start,
    })
  }
  const data = (await resp.json()) as PolledResponse

  const rows: SnapshotRow[] = []
  for (const m of Object.values(data.markets ?? {})) {
    const r = rowFor(m)
    if (r) rows.push(r)
  }

  // Resolve / create the market_sources row
  const db = createAdminClient()
  const { data: existing } = await db
    .from('market_sources')
    .select('id').eq('slug', 'draftkings_predictions').maybeSingle()
  let sourceId = existing?.id as string | undefined
  if (!sourceId) {
    const { data: created, error } = await db
      .from('market_sources')
      .insert({
        name:        'DraftKings Predictions',
        slug:        'draftkings_predictions',
        source_type: 'sportsbook',
        is_active:   true,
      })
      .select('id').single()
    if (error || !created?.id) {
      return NextResponse.json({
        ok: false, stage: 'market_sources',
        error: error?.message ?? 'unable to resolve source row',
        elapsedMs: Date.now() - start,
      })
    }
    sourceId = created.id
  }

  let inserted = 0
  let writeError: string | null = null
  if (rows.length > 0) {
    const now = new Date().toISOString()
    const { error } = await db.from('prediction_market_snapshots').insert(
      rows.map(r => ({
        source_id:            sourceId,
        contract_title:       titleFor(r.ticker),
        external_contract_id: r.ticker,
        yes_price:            r.yesProb,
        no_price:             r.noProb,
        total_volume:         r.volume,
        snapshot_time:        now,
      })),
    )
    if (error) writeError = error.message
    else inserted = rows.length
  }

  return NextResponse.json({
    ok: true,
    exchangeStatus: data.exchange?.status ?? null,
    requestedTickers: tickers.length,
    polledMarkets:    Object.keys(data.markets ?? {}).length,
    pricedRows:       rows.length,
    inserted,
    writeError,
    elapsedMs: Date.now() - start,
  })
}
