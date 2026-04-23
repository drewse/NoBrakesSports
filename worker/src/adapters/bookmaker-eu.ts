import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Bookmaker.eu — long-running offshore. Own backend (not BetOnline SAS,
// not the ASI platform). Wall type unknown until first probe.
export const bookmakerEuAdapter = buildOffshoreProbeAdapter({
  slug: 'bookmaker_eu',
  name: 'Bookmaker.eu',
  seedUrl: 'https://www.bookmaker.eu/sports',
  apiHostRegex: /bookmaker\.eu\/(api|services|feed)/i,
  leaguePaths: [
    { url: 'https://www.bookmaker.eu/sports/basketball/nba', leagueSlug: 'nba' },
    { url: 'https://www.bookmaker.eu/sports/baseball/mlb',   leagueSlug: 'mlb' },
    { url: 'https://www.bookmaker.eu/sports/hockey/nhl',     leagueSlug: 'nhl' },
  ],
})
