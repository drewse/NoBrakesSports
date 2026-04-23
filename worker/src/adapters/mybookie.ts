import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// MyBookie.ag — Curaçao offshore, accepts US/CA. CF-gated on the .ag
// host; real Chromium through PacketStream US is the first probe.
export const mybookieAdapter = buildOffshoreProbeAdapter({
  slug: 'mybookie',
  name: 'MyBookie',
  seedUrl: 'https://www.mybookie.ag/sportsbook',
  apiHostRegex: /mybookie\.ag\/(api|services)/i,
  leaguePaths: [
    { url: 'https://www.mybookie.ag/sportsbook/nba', leagueSlug: 'nba' },
    { url: 'https://www.mybookie.ag/sportsbook/mlb', leagueSlug: 'mlb' },
    { url: 'https://www.mybookie.ag/sportsbook/nhl', leagueSlug: 'nhl' },
  ],
  pollIntervalSec: 7200,  // 2h — cap IPRoyal US-mobile cost
})
