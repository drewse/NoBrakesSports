import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Betovo — niche CA sportsbook on betovo.ca. Homepage 200 direct from
// a Canadian IP; small page (~30 KB) suggests the betting UI is a
// thin SPA routing to a backend we need to discover.
export const betovoAdapter = buildOffshoreProbeAdapter({
  slug: 'betovo',
  name: 'Betovo',
  seedUrl: 'https://betovo.ca',
  apiHostRegex: /\/(api|graphql|v\d+|sportsbook|offering|listView|events|markets|lines)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://betovo.ca/en/sports/basketball/nba', leagueSlug: 'nba' },
    { url: 'https://betovo.ca/en/sports/baseball/mlb',   leagueSlug: 'mlb' },
    { url: 'https://betovo.ca/en/sports/hockey/nhl',     leagueSlug: 'nhl' },
  ],
  // PacketStream CA returned ERR_EMPTY_RESPONSE. Escalated to IPRoyal
  // CA mobile — mobile CIDRs pass the CF-reputation wall that residential
  // got blocked by.
  useProxy: 'mobile',
  pollIntervalSec: 7200,
})
