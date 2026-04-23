import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Sportzino — US sweepstakes sportsbook running on the Altenar widget
// platform. Discovery revealed the event list endpoint is
// /api/widget/GetTopEvents on sb2frontend-altenar2.biahosted.com.
// Regex tuned to match Altenar widget paths on the biahosted hosts so
// we capture the event-list response body; parser wires next iteration.
export const sportzinoAdapter = buildOffshoreProbeAdapter({
  slug: 'sportzino',
  name: 'Sportzino',
  seedUrl: 'https://sportzino.com',
  apiHostRegex: /biahosted\.com\/api\/(widget|Unauthenticated)|\/api\/(widget|Unauthenticated|sportsbook|odds|markets|events|lines)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://sportzino.com/sportsbook/nba', leagueSlug: 'nba' },
    { url: 'https://sportzino.com/sportsbook/mlb', leagueSlug: 'mlb' },
    { url: 'https://sportzino.com/sportsbook/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,
  pollIntervalSec: 7200,
})
