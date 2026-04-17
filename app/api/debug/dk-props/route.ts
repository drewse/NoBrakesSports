// Temporary debug endpoint to discover DK prop subcategory IDs
// DELETE THIS FILE after discovering the IDs

import { NextRequest, NextResponse } from 'next/server'
import { pipeFetch } from '@/lib/pipelines/proxy-fetch'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const BASE = 'https://sportsbook-nash.draftkings.com/sites/CA-ON-SB/api/sportscontent'

async function dkFetch(url: string): Promise<Response> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!resp.ok && resp.status === 403) throw new Error('blocked')
    return resp
  } catch {
    return pipeFetch(url)
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: any = {}

  // 1. Get NBA events first (we know this works)
  const leagueId = '42648'
  const subcategoryId = '4511'
  const evQ = `$filter=leagueId eq '${leagueId}' AND clientMetadata/Subcategories/any(s: s/Id eq '${subcategoryId}')`
  const mkQ = `$filter=clientMetadata/subCategoryId eq '${subcategoryId}' AND tags/all(t: t ne 'SportcastBetBuilder')`
  const gameUrl = `${BASE}/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=${leagueId}&eventsQuery=${encodeURIComponent(evQ)}&marketsQuery=${encodeURIComponent(mkQ)}&include=Events&entity=events`

  try {
    const resp = await dkFetch(gameUrl)
    const data = await resp.json()
    const events = data.events ?? []
    const eventIds = events.filter((e: any) => e.status === 'NOT_STARTED').map((e: any) => e.id)
    results.gameEvents = eventIds.length
    results.firstEventId = eventIds[0] ?? null

    // 2. Try different per-event endpoints with the first event
    if (eventIds[0]) {
      const eid = eventIds[0]
      const endpoints = [
        `${BASE}/v1/events/${eid}?format=json`,
        `${BASE}/v2/event-page?eventId=${eid}`,
        `${BASE}/v2/event-page?eventId=${eid}&format=json`,
        `${BASE}/v1/events/${eid}`,
        `${BASE}/eventgroups/${leagueId}/events/${eid}?format=json`,
      ]

      results.perEventTests = []
      for (const url of endpoints) {
        try {
          const r = await dkFetch(url)
          const body = r.ok ? await r.json() : null
          const marketCount = body?.markets?.length ?? body?.eventGroup?.markets?.length ?? 0
          const selCount = body?.selections?.length ?? body?.eventGroup?.selections?.length ?? 0
          const keys = body ? Object.keys(body).slice(0, 10) : []

          // Check for player prop market types
          const propTypes: Record<string, number> = {}
          const markets = body?.markets ?? body?.eventGroup?.markets ?? []
          for (const m of markets) {
            const t = (m.marketType?.name ?? '').toLowerCase()
            if (t !== 'moneyline' && t !== 'money line' && t !== 'spread' && t !== 'total' && t !== 'run line' && t !== 'puck line') {
              propTypes[t] = (propTypes[t] || 0) + 1
            }
          }

          results.perEventTests.push({
            url: url.replace(BASE, '...'),
            status: r.status,
            markets: marketCount,
            selections: selCount,
            keys,
            propTypes: Object.keys(propTypes).length > 0 ? propTypes : 'none',
          })
        } catch (e: any) {
          results.perEventTests.push({
            url: url.replace(BASE, '...'),
            error: e.message,
          })
        }
      }

      // 3. Try to discover subcategories
      // Check what subcategories exist on the events we already have
      const allSubcats = new Set<string>()
      for (const ev of events.slice(0, 3)) {
        const subs = ev.clientMetadata?.Subcategories ?? []
        for (const s of subs) {
          allSubcats.add(String(s.Id ?? s.id ?? s))
        }
      }
      results.discoveredSubcategoryIds = [...allSubcats].sort()

      // 4. Test each discovered subcategory to see what markets it returns
      results.subcategoryTests = []
      for (const subId of [...allSubcats].slice(0, 20)) {
        if (subId === subcategoryId) continue // skip game lines, we know that works
        try {
          const testMkQ = `$filter=clientMetadata/subCategoryId eq '${subId}' AND tags/all(t: t ne 'SportcastBetBuilder')`
          const testUrl = `${BASE}/controldata/league/leagueSubcategory/v1/markets?isBatchable=false&templateVars=${leagueId}&eventsQuery=${encodeURIComponent(evQ)}&marketsQuery=${encodeURIComponent(testMkQ)}&include=Events&entity=events`
          const r = await dkFetch(testUrl)
          if (!r.ok) {
            results.subcategoryTests.push({ subId, status: r.status })
            continue
          }
          const d = await r.json()
          const mkts = d.markets ?? []
          const types: Record<string, number> = {}
          for (const m of mkts) {
            const t = m.marketType?.name ?? 'unknown'
            types[t] = (types[t] || 0) + 1
          }
          // Sample a market name if any
          const sampleName = mkts[0]?.name ?? null
          const sampleType = mkts[0]?.marketType?.name ?? null
          results.subcategoryTests.push({
            subId,
            events: (d.events ?? []).length,
            markets: mkts.length,
            selections: (d.selections ?? []).length,
            types,
            sampleName,
            sampleType,
          })
        } catch (e: any) {
          results.subcategoryTests.push({ subId, error: e.message })
        }
      }
    }
  } catch (e: any) {
    results.error = e.message
  }

  return NextResponse.json(results, { status: 200 })
}
