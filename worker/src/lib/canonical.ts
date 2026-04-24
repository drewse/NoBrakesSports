/** Must match app/lib/pipelines/normalize.ts canonicalEventKey() exactly so
 *  events scraped here line up with ones created by the Vercel cron. */

// Must stay in sync with lib/pipelines/normalize.ts TEAM_CITY_ALIASES
// so worker scrapes and Vercel crons produce identical canonical keys.
// Insertion order matters (first matching prefix wins) — 3-letter abbrs
// come before 2-letter so "okc lakers" can't accidentally hit a shorter
// prefix.
const TEAM_CITY_ALIASES: Record<string, string> = {
  // 3-letter
  'okc ': 'oklahoma city ', 'okc': 'oklahoma city',
  'phi ': 'philadelphia ',  'phi': 'philadelphia',
  'phx ': 'phoenix ',       'phx': 'phoenix',
  'pho ': 'phoenix ',       'pho': 'phoenix',
  'hou ': 'houston ',       'hou': 'houston',
  'por ': 'portland ',      'por': 'portland',
  'orl ': 'orlando ',       'orl': 'orlando',
  'chi ': 'chicago ',       'chi': 'chicago',
  'det ': 'detroit ',       'det': 'detroit',
  'atl ': 'atlanta ',       'atl': 'atlanta',
  'bos ': 'boston ',        'bos': 'boston',
  'was ': 'washington ',    'was': 'washington',
  'wsh ': 'washington ',    'wsh': 'washington',
  'dal ': 'dallas ',        'dal': 'dallas',
  'den ': 'denver ',        'den': 'denver',
  'mia ': 'miami ',         'mia': 'miami',
  'min ': 'minnesota ',     'min': 'minnesota',
  'mil ': 'milwaukee ',     'mil': 'milwaukee',
  'mem ': 'memphis ',       'mem': 'memphis',
  'ind ': 'indiana ',       'ind': 'indiana',
  'sac ': 'sacramento ',    'sac': 'sacramento',
  'uta ': 'utah ',          'uta': 'utah',
  'cle ': 'cleveland ',     'cle': 'cleveland',
  'nsh ': 'nashville ',     'nsh': 'nashville',
  'cgy ': 'calgary ',       'cgy': 'calgary',
  'van ': 'vancouver ',     'van': 'vancouver',
  'edm ': 'edmonton ',      'edm': 'edmonton',
  'mtl ': 'montreal ',      'mtl': 'montreal',
  'ott ': 'ottawa ',        'ott': 'ottawa',
  'wpg ': 'winnipeg ',      'wpg': 'winnipeg',
  'buf ': 'buffalo ',       'buf': 'buffalo',
  'cin ': 'cincinnati ',    'cin': 'cincinnati',
  'pit ': 'pittsburgh ',    'pit': 'pittsburgh',
  'bal ': 'baltimore ',     'bal': 'baltimore',
  'jax ': 'jacksonville ',  'jax': 'jacksonville',
  'ten ': 'tennessee ',     'ten': 'tennessee',
  'car ': 'carolina ',      'car': 'carolina',
  'ari ': 'arizona ',       'ari': 'arizona',
  'cha ': 'charlotte ',     'cha': 'charlotte',
  'col ': 'colorado ',      'col': 'colorado',
  'sea ': 'seattle ',       'sea': 'seattle',
  'tor ': 'toronto ',       'tor': 'toronto',
  // 2-letter
  'la ': 'los angeles ',    'la': 'los angeles',
  'ny ': 'new york ',       'ny': 'new york',
  'sf ': 'san francisco ',  'sf': 'san francisco',
  'gs ': 'golden state ',   'gs': 'golden state',
  'sa ': 'san antonio ',    'sa': 'san antonio',
  'sd ': 'san diego ',      'sd': 'san diego',
  'kc ': 'kansas city ',    'kc': 'kansas city',
  'gb ': 'green bay ',      'gb': 'green bay',
  'lv ': 'las vegas ',      'lv': 'las vegas',
  'ne ': 'new england ',    'ne': 'new england',
  'no ': 'new orleans ',    'no': 'new orleans',
  'nj ': 'new jersey ',     'nj': 'new jersey',
  'tb ': 'tampa bay ',      'tb': 'tampa bay',
  // Nicknames
  'philly ': 'philadelphia ', 'philly': 'philadelphia',
  'sixers': '76ers',
}

function normalizeTeam(raw: string): string {
  let t = (raw || '').toLowerCase().trim()
  // Strip common parentheticals (pitcher names, TBD markers)
  t = t.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  // Collapse whitespace
  t = t.replace(/\s+/g, ' ')
  // City aliases
  for (const [alias, canonical] of Object.entries(TEAM_CITY_ALIASES)) {
    if (t.startsWith(alias)) {
      t = canonical + t.slice(alias.length)
      break
    }
  }
  return t
}

/** Deterministic key shared across all adapters — date + sorted team pair.
 *  Must produce identical output to lib/pipelines/normalize.ts
 *  canonicalEventKey() — any divergence creates duplicate events because
 *  worker-side writes and Vercel-side cron writes compute different
 *  external_id values and the unique constraint lets both through.
 *  Date parsing goes through `new Date(...).toISOString()` so non-ISO
 *  startTime strings (e.g. "04/24/2026 18:40", local-offset ISO like
 *  "2026-04-24T21:50:00-04:00") collapse to the same UTC date both
 *  sides. */
export function canonicalEventKey(args: {
  leagueSlug: string
  startTime: string
  homeTeam: string
  awayTeam: string
}): string {
  const teams = [normalizeTeam(args.homeTeam), normalizeTeam(args.awayTeam)].sort()
  const parsed = new Date(args.startTime)
  const date = isNaN(parsed.getTime())
    ? (args.startTime || '').slice(0, 10)  // fall back to raw slice if unparseable
    : parsed.toISOString().slice(0, 10)
  return `${args.leagueSlug}:${date}:${teams[0]}:${teams[1]}`
}

export function americanToImpliedProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100)
  return -odds / (-odds + 100)
}

export function computeOddsHash(row: {
  home_price: number | null
  away_price: number | null
  draw_price: number | null
  spread_value: number | null
  total_value: number | null
  over_price: number | null
  under_price: number | null
}): string {
  return [
    row.home_price ?? '', row.away_price ?? '', row.draw_price ?? '',
    row.spread_value ?? '', row.total_value ?? '',
    row.over_price ?? '', row.under_price ?? '',
  ].join('|')
}

export function computePropOddsHash(
  over: number | null, under: number | null, yes: number | null, no: number | null
): string {
  return [over ?? '', under ?? '', yes ?? '', no ?? ''].join('|')
}
