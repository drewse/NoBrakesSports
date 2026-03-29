const BASE_URL = 'https://gamma-api.polymarket.com'

export interface PolymarketMarket {
  id: string
  question: string
  slug: string
  conditionId: string
  outcomePrices: string  // JSON: ["0.62", "0.38"]
  outcomes: string       // JSON: ["Yes", "No"]
  volume: string
  active: boolean
  closed: boolean
  endDate: string
  startDate: string
}

export interface PolymarketEvent {
  id: string
  title: string
  slug: string
  startDate: string
  endDate: string
  active: boolean
  volume: string
  tags?: Array<{ id: string; label: string; slug: string }>
  markets: PolymarketMarket[]
}

const PAGE_SIZE = 100
const MAX_PAGES = 10 // cap at 1000 events total

export async function fetchPolymarketEvents(): Promise<PolymarketEvent[]> {
  const all: PolymarketEvent[] = []

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
      tag_slug: 'sports',
    })

    const res = await fetch(`${BASE_URL}/events?${params}`, {
      next: { revalidate: 0 },
    })

    if (!res.ok) throw new Error(`Polymarket API ${res.status}: ${await res.text()}`)

    const data = await res.json()
    const events: PolymarketEvent[] = Array.isArray(data) ? data : (data.events ?? [])
    if (!events.length) break

    all.push(...events.map(e => ({ ...e, markets: e.markets ?? [] })))

    // If we got fewer than a full page, we've reached the end
    if (events.length < PAGE_SIZE) break
  }

  return all
}

function parseJsonField<T>(field: unknown): T | null {
  if (Array.isArray(field)) return field as T
  if (typeof field === 'string') {
    try { return JSON.parse(field) } catch { return null }
  }
  return null
}

export function parsePolymarketPrices(market: PolymarketMarket): { yes: number; no: number } | null {
  try {
    const prices = parseJsonField<string[]>(market.outcomePrices)
    const outcomes = parseJsonField<string[]>(market.outcomes)
    if (!prices || !outcomes) return null
    const yesIdx = outcomes.findIndex(o => o.toLowerCase() === 'yes')
    const noIdx = outcomes.findIndex(o => o.toLowerCase() === 'no')
    if (yesIdx === -1 || noIdx === -1) return null
    return {
      yes: parseFloat(prices[yesIdx]),
      no: parseFloat(prices[noIdx]),
    }
  } catch {
    return null
  }
}
