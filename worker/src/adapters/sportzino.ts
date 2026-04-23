import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Sportzino — US sweepstakes sportsbook. sportzino.com returns 1 MB of
// HTML direct from any IP so no proxy should be needed. allHosts
// diagnostic will show where the SPA actually fetches odds data.
export const sportzinoAdapter = buildOffshoreProbeAdapter({
  slug: 'sportzino',
  name: 'Sportzino',
  seedUrl: 'https://sportzino.com',
  apiHostRegex: /\/(api|graphql|v\d+|sportsbook|odds|markets|events|lines)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://sportzino.com/sportsbook/nba', leagueSlug: 'nba' },
    { url: 'https://sportzino.com/sportsbook/mlb', leagueSlug: 'mlb' },
    { url: 'https://sportzino.com/sportsbook/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,
  pollIntervalSec: 7200,
})
