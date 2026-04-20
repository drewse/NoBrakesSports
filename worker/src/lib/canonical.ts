/** Must match app/lib/pipelines/normalize.ts canonicalEventKey() exactly so
 *  events scraped here line up with ones created by the Vercel cron. */

const TEAM_CITY_ALIASES: Record<string, string> = {
  'la ': 'los angeles ',
  'la': 'los angeles',
  'ny ': 'new york ',
  'ny': 'new york',
  'sf ': 'san francisco ',
  'sf': 'san francisco',
  'philly': 'philadelphia',
  'philly ': 'philadelphia ',
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

/** Deterministic key shared across all adapters — date + sorted team pair. */
export function canonicalEventKey(args: {
  leagueSlug: string
  startTime: string
  homeTeam: string
  awayTeam: string
}): string {
  const teams = [normalizeTeam(args.homeTeam), normalizeTeam(args.awayTeam)].sort()
  const date = (args.startTime || '').slice(0, 10)
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
