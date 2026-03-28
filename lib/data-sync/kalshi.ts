// Kalshi public REST API — no auth required for market data
const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

export interface KalshiMarket {
  ticker: string
  title: string
  category: string
  status: string
  yes_bid: number         // integer cents if present (legacy)
  yes_ask: number
  no_bid: number
  no_ask: number
  yes_bid_dollars?: string  // string decimal e.g. "0.5500" — actual current field
  no_bid_dollars?: string
  last_price: number
  volume: number
  open_interest: number
  close_time: string
  event_ticker: string
}

export interface KalshiResponse {
  markets: KalshiMarket[]
  cursor?: string
}

const SPORTS_KEYWORDS = ['nfl', 'nba', 'mlb', 'nhl', 'mls', 'ncaa', 'super bowl',
  'championship', 'playoff', 'world series', 'stanley cup', 'finals', 'soccer',
  'basketball', 'football', 'baseball', 'hockey', 'tennis', 'golf', 'ufc', 'mma']

export function isSportsMarket(market: KalshiMarket): boolean {
  const cat = (market.category ?? '').toLowerCase()
  const title = (market.title ?? '').toLowerCase()
  return SPORTS_KEYWORDS.some(k => cat.includes(k) || title.includes(k))
}

export async function fetchKalshiMarkets(): Promise<KalshiMarket[]> {
  const params = new URLSearchParams({ status: 'open', limit: '200' })

  const res = await fetch(`${BASE_URL}/markets?${params}`, {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Kalshi API ${res.status}: ${body.slice(0, 200)}`)
  }

  const data: KalshiResponse = await res.json()
  return (data.markets ?? []).filter(isSportsMarket)
}

// Kalshi prices: prefer dollar string field (0.0–1.0), fall back to cents integer
export function kalshiPriceToProb(market: KalshiMarket, side: 'yes' | 'no'): number {
  if (side === 'yes') {
    if (market.yes_bid_dollars != null) return parseFloat(market.yes_bid_dollars)
    return (market.yes_bid ?? 0) / 100
  }
  if (market.no_bid_dollars != null) return parseFloat(market.no_bid_dollars)
  return (market.no_bid ?? 0) / 100
}
