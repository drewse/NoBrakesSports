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
  return Array.isArray(data) ? data : (data.events ?? [])
}

export function parsePolymarketPrices(market: PolymarketMarket): { yes: number; no: number } | null {
  try {
    const prices: string[] = JSON.parse(market.outcomePrices)
    const outcomes: string[] = JSON.parse(market.outcomes)
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
