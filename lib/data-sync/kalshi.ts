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

// Sports series tickers on Kalshi — game winner, totals, and player prop series
const SPORTS_SERIES = [
  'KXNBAGAME',   // NBA game winner
  'KXNBAPTS',    // NBA player points
  'KXMLBGAME',   // MLB game winner
  'KXMLBHIT',    // MLB player hits
  'KXMLBTOTAL',  // MLB game totals
  'KXNHLGAME',   // NHL game winner
  'KXNFLGAME',   // NFL game winner (in season)
  'KXNFLPTS',    // NFL player points
]

export interface KalshiFetchResult {
  markets: KalshiMarket[]
  debug: { seriesCounts: Record<string, number>; total: number }
}

async function fetchSeriesMarkets(seriesTicker: string): Promise<KalshiMarket[]> {
  const params = new URLSearchParams({
    status: 'open',
    series_ticker: seriesTicker,
    limit: '200',
  })

  const res = await fetch(`${BASE_URL}/markets?${params}`, {
    headers: { Accept: 'application/json' },
    next: { revalidate: 0 },
  })

  if (!res.ok) return []  // series may not exist right now — skip silently

  const data: KalshiResponse = await res.json()
  return (data.markets ?? []).filter(m => !m.mve_collection_ticker)
}

export async function fetchKalshiMarkets(): Promise<KalshiFetchResult> {
  const results = await Promise.allSettled(
    SPORTS_SERIES.map(s => fetchSeriesMarkets(s))
  )

  const seriesCounts: Record<string, number> = {}
  const allMarkets: KalshiMarket[] = []

  results.forEach((result, i) => {
    const series = SPORTS_SERIES[i]
    if (result.status === 'fulfilled') {
      seriesCounts[series] = result.value.length
      allMarkets.push(...result.value)
    } else {
      seriesCounts[series] = -1  // error
    }
  })

  return {
    markets: allMarkets,
    debug: { seriesCounts, total: allMarkets.length },
  }
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
