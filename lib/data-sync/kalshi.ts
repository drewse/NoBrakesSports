// Kalshi public REST API — no auth required for market data
const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

export interface KalshiMarket {
  ticker: string
  title: string
  category: string
  status: string
  yes_bid: number
  yes_ask: number
  no_bid: number
  no_ask: number
  yes_bid_dollars?: string  // string decimal e.g. "0.5500"
  no_bid_dollars?: string
  liquidity_dollars?: string
  mve_collection_ticker?: string  // set on parlay/MVE markets — skip these
  last_price: number
  volume: number
  volume_fp?: string
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
  // Skip MVE/parlay markets — they're cross-leg combos with no standalone price
  if (market.mve_collection_ticker) return false
  // Skip zero-liquidity markets
  if (market.liquidity_dollars === '0.0000' && market.yes_bid_dollars === '0.0000') return false
  const cat = (market.category ?? '').toLowerCase()
  const title = (market.title ?? '').toLowerCase()
  const ticker = (market.ticker ?? '').toLowerCase()
  return SPORTS_KEYWORDS.some(k => cat.includes(k) || title.includes(k) || ticker.includes(k))
}

export async function fetchKalshiMarkets(): Promise<KalshiMarket[]> {
  const allMarkets: KalshiMarket[] = []
  let cursor: string | undefined

  // Paginate up to 5 pages (1000 markets) to find sports markets beyond MVE pages
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ status: 'open', limit: '200' })
    if (cursor) params.set('cursor', cursor)

    const res = await fetch(`${BASE_URL}/markets?${params}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Kalshi API ${res.status}: ${body.slice(0, 200)}`)
    }

    const data: KalshiResponse = await res.json()
    const markets = data.markets ?? []
    allMarkets.push(...markets)

    if (!data.cursor || markets.length < 200) break
    cursor = data.cursor
  }

  return allMarkets.filter(isSportsMarket)
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
