/** Must match app/lib/pipelines/normalize.ts canonicalEventKey() exactly so
 *  events scraped here line up with ones created by the Vercel cron. */

// Must stay in sync with lib/pipelines/normalize.ts TEAM_CITY_ALIASES
// so worker scrapes and Vercel crons produce identical canonical keys.
// Insertion order matters (first matching prefix wins) — 3-letter abbrs
// come before 2-letter so "okc lakers" can't accidentally hit a shorter
// prefix.
// Space-terminated prefixes only. See lib/pipelines/normalize.ts for
// rationale — bare forms mangled full names via startsWith (e.g.
// "boston celtics" + "bos"→"boston" became "bostonton celtics").
const TEAM_CITY_ALIASES: Record<string, string> = {
  // 3-letter
  'okc ': 'oklahoma city ',
  'phi ': 'philadelphia ',
  'phx ': 'phoenix ',
  'pho ': 'phoenix ',
  'hou ': 'houston ',
  'por ': 'portland ',
  'orl ': 'orlando ',
  'chi ': 'chicago ',
  'det ': 'detroit ',
  'atl ': 'atlanta ',
  'bos ': 'boston ',
  'was ': 'washington ',
  'wsh ': 'washington ',
  'dal ': 'dallas ',
  'den ': 'denver ',
  'mia ': 'miami ',
  'min ': 'minnesota ',
  'mil ': 'milwaukee ',
  'mem ': 'memphis ',
  'ind ': 'indiana ',
  'sac ': 'sacramento ',
  'uta ': 'utah ',
  'cle ': 'cleveland ',
  'nsh ': 'nashville ',
  'cgy ': 'calgary ',
  'van ': 'vancouver ',
  'edm ': 'edmonton ',
  'mtl ': 'montreal ',
  'ott ': 'ottawa ',
  'wpg ': 'winnipeg ',
  'buf ': 'buffalo ',
  'cin ': 'cincinnati ',
  'pit ': 'pittsburgh ',
  'bal ': 'baltimore ',
  'jax ': 'jacksonville ',
  'ten ': 'tennessee ',
  'car ': 'carolina ',
  'ari ': 'arizona ',
  'cha ': 'charlotte ',
  'col ': 'colorado ',
  'sea ': 'seattle ',
  'tor ': 'toronto ',
  // 2-letter
  'la ': 'los angeles ',
  'ny ': 'new york ',
  'sf ': 'san francisco ',
  'gs ': 'golden state ',
  'sa ': 'san antonio ',
  'sd ': 'san diego ',
  'kc ': 'kansas city ',
  'gb ': 'green bay ',
  'lv ': 'las vegas ',
  'ne ': 'new england ',
  'no ': 'new orleans ',
  'nj ': 'new jersey ',
  'tb ': 'tampa bay ',
  // Nicknames
  'philly ': 'philadelphia ',
  'sixers ': '76ers ',
}

// Full-name aliases for mid-season rebrands. Must stay in sync with
// lib/pipelines/normalize.ts TEAM_FULL_ALIASES.
const TEAM_FULL_ALIASES: Record<string, string> = {
  'utah hockey club': 'utah mammoth',
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
  // Full-name rebrand aliases (applied last)
  if (TEAM_FULL_ALIASES[t]) t = TEAM_FULL_ALIASES[t]
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
