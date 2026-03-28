// Kalshi public REST API — no auth required for market data
const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

export interface KalshiMarket {
  ticker: string
  title: string
  category: string
  status: string
  yes_bid: number   // cents (0–99)
  yes_ask: number
  no_bid: number
  no_ask: number
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

// Kalshi prices are in cents (0–99), convert to 0–1 probability
export function kalshiPriceToProb(cents: number): number {
  return cents / 100
}
