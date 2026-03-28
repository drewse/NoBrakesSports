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

export async function fetchPolymarketEvents(): Promise<PolymarketEvent[]> {
  const params = new URLSearchParams({
    active: 'true',
    closed: 'false',
    limit: '100',
    tag_slug: 'sports',
  })

  const res = await fetch(`${BASE_URL}/events?${params}`, {
    next: { revalidate: 0 },
  })

  if (!res.ok) throw new Error(`Polymarket API ${res.status}: ${await res.text()}`)

  const data = await res.json()
  const events: PolymarketEvent[] = Array.isArray(data) ? data : (data.events ?? [])

  // Normalize: some API responses omit the markets array — treat as empty
  return events.map(e => ({ ...e, markets: e.markets ?? [] }))
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
