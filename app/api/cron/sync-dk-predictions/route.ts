// GET /api/cron/sync-dk-predictions
//
// Two-step sync for DraftKings Predictions:
//
//   1. Discovery — POST https://api.draftkings.com/en/scoreboard/v1/competitionSummary
//      body: { competitionDkIds: [<id>...] }
//      Returns the markets / outcomes that exist for that competition.
//      Walk the response to collect every "marketTicker" (DKPx-…) string.
//
//   2. Pricing — POST https://api.draftkings.com/en/predict/v1/polling/clients/web/markets
//      body: { marketTickers: <from step 1>, languageCode: 'en' }
//      Returns the live yes/no probabilities for each ticker.
//
// Both endpoints are public over HTTPS — the cookies in the captured curl
// were Akamai bot-management challenge cookies that DK sets on real
// browsers; api.draftkings.com itself accepts plain JSON POSTs from
// server contexts as long as the Origin header matches the predictions
// app. If a Vercel IP gets gated, we'll fall back to pipeFetch (the
// proxy helper used by the other DK adapters) — but on the first run
// we try direct fetch and surface the result.
//
// This route is intentionally forgiving: it logs the response shape of
// both calls and only writes to prediction_market_snapshots when it can
// confidently identify a yes/no probability. As we iterate the parser
// from real response samples, more fields get unlocked.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

const SUMMARY_URL = 'https://api.draftkings.com/en/scoreboard/v1/competitionSummary'
const POLL_URL    = 'https://api.draftkings.com/en/predict/v1/polling/clients/web/markets'

// Known competition IDs. 968006 was confirmed as NBA via DevTools
// (2026-04-25 capture). Add MLB/NHL/NFL once we have their IDs from
// the next DevTools session — first-pass logging will surface them.
const COMPETITION_IDS = [968006]

const HEADERS: Record<string, string> = {
  Accept:           'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type':   'application/json',
  Origin:           'https://predictions.draftkings.com',
  Referer:          'https://predictions.draftkings.com/',
  'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
}

function verifyCron(request: NextRequest): boolean {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret) return false
  return (
    secret === process.env.CRON_SECRET ||
    secret === process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  )
}

async function postJson(url: string, body: unknown) {
  const start = Date.now()
  let resp: Response
  try {
    resp = await fetch(url, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(body),
    })
  } catch (e: any) {
    return { ok: false, status: 0, elapsedMs: Date.now() - start, error: e?.message ?? String(e), data: null as any, text: '' }
  }
  const text = await resp.text()
  let data: any = null
  try { data = JSON.parse(text) } catch { /* ignore */ }
  return { ok: resp.ok, status: resp.status, elapsedMs: Date.now() - start, error: null as string | null, data, text }
}

/** Recursively walk a JSON tree and collect every string that looks
 *  like a DraftKings Predictions ticker (DKP3-… or DKP2-…). */
function collectTickers(root: unknown): string[] {
  const out = new Set<string>()
  const stack: unknown[] = [root]
  while (stack.length) {
    const v = stack.pop()
    if (!v) continue
    if (typeof v === 'string') {
      if (/^DKP\d+-/.test(v)) out.add(v)
      continue
    }
    if (Array.isArray(v)) {
      for (const it of v) stack.push(it)
      continue
    }
    if (typeof v === 'object') {
      for (const it of Object.values(v as Record<string, unknown>)) stack.push(it)
    }
  }
  return [...out]
}

/** Walk the polling response and return one row per market with whatever
 *  yes/no price + title we can identify. The DK polling shape isn't
 *  documented, so we look for the most common field shapes and fall
 *  back to logging raw items we can't classify. */
interface PriceRow {
  ticker: string
  yesProb: number | null
  noProb:  number | null
  title:   string | null
  raw:     unknown
}
function extractPrices(pollData: any): { rows: PriceRow[]; rawItems: number; arrayKey: string | null } {
  const rows: PriceRow[] = []
  if (!pollData || typeof pollData !== 'object') return { rows, rawItems: 0, arrayKey: null }

  // Find the first array under any top-level key — that's almost always
  // the markets list in DK API responses.
  let items: any[] = []
  let arrayKey: string | null = null
  if (Array.isArray(pollData)) {
    items = pollData
  } else {
    for (const [k, v] of Object.entries(pollData)) {
      if (Array.isArray(v) && v.length > 0) { items = v as any[]; arrayKey = k; break }
    }
  }

  for (const it of items) {
    if (!it || typeof it !== 'object') continue
    const ticker = String(it.marketTicker ?? it.ticker ?? it.id ?? '')
    if (!/^DKP\d+-/.test(ticker)) continue

    // Common probability field shapes seen in DK predict-style payloads:
    //   probability (0..1), yesProbability (0..1), price (0..100 cents),
    //   yesPrice/noPrice (0..100 cents).
    const yesProbRaw =
      it.yesProbability ?? it.probability ?? it.yesProb ?? null
    const noProbRaw =
      it.noProbability  ?? it.noProb ?? null
    const yesCents =
      it.yesPrice ?? it.price ?? null
    const noCents =
      it.noPrice ?? null

    const yesProb =
      typeof yesProbRaw === 'number' ? yesProbRaw :
      typeof yesCents === 'number'   ? yesCents / 100 : null
    const noProb =
      typeof noProbRaw === 'number'  ? noProbRaw :
      typeof noCents  === 'number'   ? noCents / 100 :
      yesProb != null                ? 1 - yesProb : null

    rows.push({
      ticker,
      yesProb,
      noProb,
      title: (it.displayName ?? it.title ?? it.name ?? null) as string | null,
      raw:   it,
    })
  }

  return { rows, rawItems: items.length, arrayKey }
}

export async function GET(request: NextRequest) {
  if (!verifyCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const start = Date.now()

  // ── Step 1: discover tickers from competitionSummary ──────────────
  const summary = await postJson(SUMMARY_URL, { competitionDkIds: COMPETITION_IDS })
  if (!summary.ok || !summary.data) {
    return NextResponse.json({
      ok: false,
      stage: 'summary',
      httpStatus: summary.status,
      elapsedMs: Date.now() - start,
      error: summary.error,
      preview: summary.text.slice(0, 600),
    })
  }
  const tickers = collectTickers(summary.data)

  // ── Step 2: poll prices for every discovered ticker ───────────────
  let poll = { ok: false, status: 0, elapsedMs: 0, error: null as string | null, data: null as any, text: '' }
  let extracted = { rows: [] as PriceRow[], rawItems: 0, arrayKey: null as string | null }
  if (tickers.length > 0) {
    poll = await postJson(POLL_URL, { marketTickers: tickers, languageCode: 'en' })
    extracted = extractPrices(poll.data)
  }

  // ── Step 3: write to prediction_market_snapshots ──────────────────
  let snapshotsInserted = 0
  let writeError: string | null = null
  if (extracted.rows.length > 0) {
    try {
      const db = createAdminClient()
      const { data: src } = await db
        .from('market_sources')
        .select('id')
        .eq('slug', 'draftkings_predictions')
        .maybeSingle()
      let sourceId = src?.id as string | undefined
      if (!sourceId) {
        const { data: created } = await db
          .from('market_sources')
          .insert({
            name: 'DraftKings Predictions',
            slug: 'draftkings_predictions',
            source_type: 'sportsbook',
            is_active: true,
          })
          .select('id').single()
        sourceId = created?.id
      }
      if (sourceId) {
        const now = new Date().toISOString()
        const rows = extracted.rows
          .filter(r => r.yesProb != null && r.noProb != null && r.title)
          .map(r => ({
            source_id:            sourceId,
            contract_title:       r.title!,
            external_contract_id: r.ticker,
            yes_price:            Math.round((r.yesProb as number) * 10000) / 10000,
            no_price:             Math.round((r.noProb  as number) * 10000) / 10000,
            snapshot_time:        now,
          }))
        if (rows.length > 0) {
          const { error } = await db.from('prediction_market_snapshots').insert(rows)
          if (error) writeError = error.message
          else snapshotsInserted = rows.length
        }
      } else {
        writeError = 'failed to resolve market_sources row'
      }
    } catch (e: any) {
      writeError = e?.message ?? String(e)
    }
  }

  return NextResponse.json({
    ok: summary.ok,
    competitionIds: COMPETITION_IDS,
    summary: {
      httpStatus: summary.status,
      elapsedMs:  summary.elapsedMs,
      keys:       summary.data && typeof summary.data === 'object'
                  ? Object.keys(summary.data as Record<string, unknown>).slice(0, 20)
                  : null,
      tickerCount: tickers.length,
      sampleTickers: tickers.slice(0, 5),
    },
    poll: tickers.length > 0
      ? {
          httpStatus: poll.status,
          elapsedMs:  poll.elapsedMs,
          rawItems:   extracted.rawItems,
          arrayKey:   extracted.arrayKey,
          parsedRows: extracted.rows.length,
          sampleRow:  extracted.rows[0] ?? null,
          // Surface one raw item too so we can refine field detection
          rawSample:  extracted.rawItems > 0 && Array.isArray(poll.data)
                      ? poll.data[0]
                      : (extracted.arrayKey && poll.data ? (poll.data as any)[extracted.arrayKey][0] : null),
        }
      : null,
    snapshotsInserted,
    writeError,
    elapsedMs: Date.now() - start,
  })
}
