// GET /api/cron/sync-dk-predictions
// Discovery-mode probe for DraftKings Predictions.
//
// Endpoint discovered from a real DevTools capture:
//   POST https://api.draftkings.com/en/predict/v1/polling/clients/web/markets
//   Body: { marketTickers: string[], languageCode: 'en' }
//   Origin: https://predictions.draftkings.com
//
// Ticker shape (decoded from the captured payload):
//   DKP3-SP{LEAGUE}GL{TYPE}{MARKET_ID}-{OUTCOME_ID}
//     LEAGUE  = NBA / MLB / NHL / etc.
//     TYPE    = ML | SPR | TP   (moneyline / spread / total points)
//     OUTCOME = W{id} for sportsbook game-lines, single-letter for futures
//
// We don't yet know the *discovery* endpoint that lists today's markets
// — the captured curl has the full ticker list inlined. This route runs
// the polling endpoint with a baked-in seed list so we can:
//   1. confirm the polling endpoint actually returns data on Vercel
//   2. log the response shape so we can wire the parser correctly next
//      iteration
// Once we find the listing endpoint, this route will switch from a
// hardcoded seed list to a dynamic ticker fetch.

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

function verifyCron(request: NextRequest): boolean {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return (
    secret === process.env.CRON_SECRET ||
    secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
}

const POLL_URL = 'https://api.draftkings.com/en/predict/v1/polling/clients/web/markets'

// Seed tickers captured from the DevTools session shared 2026-04-25.
// These will be stale tomorrow — the listing endpoint that produces them
// is still TBD. Used only to prove the polling endpoint is reachable.
const SEED_TICKERS = [
  'DKP3-SPNBAGLMLXAL4CJWM7HAFG-WXAL4CJWYX62JO',
  'DKP3-SPNBAGLMLXAL4CJWM7HAFG-WXAL4CJWXV89WT',
  'DKP3-SPNBAGLSPRXALFUE8JS2N97FG-W-11.5XALFUE8O91PVK',
  'DKP3-SPNBAGLTPXALFUKNJUWZBFG-O204.5XALFUKNPEGXH4',
  'DKP3-SPNBAGLMLXAL4CJX03C851FG-WXAL4CJXB18HWO',
  'DKP3-SPNBAGLMLXAL4CJX03C851FG-WXAL4CJXC33MT',
  'DKP3-SPNBAGLSPRXALG0TS2K5I4TFG-W-1.5XALG0TSLM3NVH',
  'DKP3-SPNBAGLTPXALG10B5RHS4EFG-O229.5XALG10BDZL5EY',
]

const HEADERS: Record<string, string> = {
  Accept:           'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type':   'application/json',
  Origin:           'https://predictions.draftkings.com',
  Referer:          'https://predictions.draftkings.com/',
  'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  let resp: Response
  try {
    resp = await fetch(POLL_URL, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        marketTickers: SEED_TICKERS,
        languageCode:  'en',
      }),
    })
  } catch (e: any) {
    return NextResponse.json({
      ok: false, stage: 'fetch',
      error: e?.message ?? String(e),
      elapsedMs: Date.now() - start,
    })
  }

  const text = await resp.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* not JSON */ }

  // Surface enough of the response to design the parser without dumping
  // every byte to logs. Top-level keys + sample of one item.
  const summary = (() => {
    if (!parsed) return { kind: 'non-json', preview: text.slice(0, 400) }
    if (Array.isArray(parsed)) {
      return { kind: 'array', count: parsed.length, sample: parsed[0] ?? null }
    }
    if (typeof parsed === 'object') {
      const keys = Object.keys(parsed)
      const firstArrayKey = keys.find(k => Array.isArray(parsed[k]))
      return {
        kind:    'object',
        keys,
        firstArrayKey,
        firstArraySample: firstArrayKey ? parsed[firstArrayKey][0] ?? null : null,
      }
    }
    return { kind: typeof parsed }
  })()

  return NextResponse.json({
    ok: resp.ok,
    httpStatus: resp.status,
    elapsedMs:  Date.now() - start,
    seedCount:  SEED_TICKERS.length,
    summary,
  })
}
