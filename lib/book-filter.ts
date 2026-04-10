export const BOOK_FILTER_COOKIE = 'nb_books'

// US-licensed / US-facing sportsbooks (Odds API region: us, us2)
export const USA_BOOK_SLUGS = new Set([
  'draftkings', 'fanduel', 'betmgm', 'caesars', 'pointsbet',
  'betrivers', 'unibet', 'mybookie', 'bovada', 'barstool',
  'betonline', 'betanysports', 'lowvig', 'betus', 'wynnbet',
  'espnbet', 'hardrockbet', 'fanatics', 'ballybet', 'betparx',
  'circa', 'fliff', 'novig', 'foxbet', 'twinspires', 'superbook',
  'williamhill', 'bet365', 'pinnacle', 'betsson', 'betway',
  'williamhill_us', 'station', 'wynn', 'golden_nugget',
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
