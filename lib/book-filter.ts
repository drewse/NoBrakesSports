export const BOOK_FILTER_COOKIE = 'nb_books'

// US-licensed, state-regulated sportsbooks. Offshore and prediction-market
// books live in their own sets below so the /books page can render them as
// distinct sections.
export const USA_BOOK_SLUGS = new Set([
  'draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet',
  'betrivers', 'unibet', 'barstool', 'wynnbet', 'espnbet',
  'hardrockbet', 'fanatics', 'ballybet', 'betparx', 'circa',
  'fliff', 'foxbet', 'twinspires', 'superbook', 'williamhill',
  'bet365', 'pinnacle', 'betsson', 'betway', 'williamhill_us',
  'station', 'wynn', 'golden_nugget',
])

// Canadian-licensed sportsbooks — static fallback.
// At runtime the BookSelector receives pipeline slugs from the DB
// (data_pipelines table) which is the authoritative Canadian book list.
export const CANADA_BOOK_SLUGS_FALLBACK = new Set([
  'sports_interaction', 'thescore', 'pointsbet_on', 'betway', 'betvictor',
  'bet99', 'northstarbets', 'proline', '888sport', 'bwin', 'betano',
  'leovegas', 'tonybet', 'casumo', 'ballybet', 'partypoker', 'jackpotbet',
  'fanduel', 'draftkings', 'betmgm', 'caesars', 'betrivers', 'bet365', 'pinnacle',
])

// Prediction markets / event-contract exchanges — priced as order books
// rather than traditional sportsbook lines. Separate surface from the
// licensed US sportsbooks.
export const PREDICTION_MARKET_SLUGS = new Set([
  'kalshi', 'polymarket', 'polymarket-us', 'robinhood-prediction',
  'sporttrade', 'novig', 'prophet-exchange',
])

// Offshore (Curaçao / Panama-licensed) books that accept US customers
// without state licensing. Grouped separately so users can opt them in
// or out as a bloc.
export const OFFSHORE_BOOK_SLUGS = new Set([
  'bovada', 'betus', 'betanysports', 'lowvig', 'mybookie', 'betonline',
])

/**
 * Parse the nb_books cookie value into a Set of enabled slugs.
 * Returns null if all books should be shown (cookie absent or "all").
 */
export function parseEnabledBooks(cookieValue: string | undefined): Set<string> | null {
  if (!cookieValue || cookieValue === 'all') return null
  try {
    const parsed = JSON.parse(cookieValue)
    if (Array.isArray(parsed) && parsed.length > 0) {
      return new Set(parsed as string[])
    }
  } catch {
    // malformed cookie — treat as all
  }
  return null
}
