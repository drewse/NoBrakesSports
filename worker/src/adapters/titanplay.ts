import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// TitanPlay — Ontario-licensed operator. titanplay.ca returns 200
// directly from a CA IP; the SPA is the discovery target. Platform
// unknown (SBTech/Kambi/proprietary) — we'll see after first cycle.
export const titanplayAdapter = buildOffshoreProbeAdapter({
  slug: 'titanplay',
  name: 'TitanPlay',
  seedUrl: 'https://titanplay.ca',
  apiHostRegex: /\/(api|graphql|v\d+|sportsbook|offering|listView|events|markets)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://titanplay.ca/en/sportsbook/basketball/nba', leagueSlug: 'nba' },
    { url: 'https://titanplay.ca/en/sportsbook/baseball/mlb',   leagueSlug: 'mlb' },
    { url: 'https://titanplay.ca/en/sportsbook/hockey/nhl',     leagueSlug: 'nhl' },
  ],
  // PacketStream CA TCP-dropped titanplay.ca. Escalated to IPRoyal CA
  // mobile — mobile CIDRs pass the CF-reputation wall that residential
  // got blocked by.
  useProxy: 'mobile',
  pollIntervalSec: 7200,
})
