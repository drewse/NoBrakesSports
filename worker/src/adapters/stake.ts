import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Stake.us (sweepstakes) + stake.com (offshore crypto). Both direct
// curl probes returned 403 — Cloudflare gate. Real browser via
// IPRoyal US mobile is the first probe. If anon sessions still 403
// (likely — Stake enforces account gating like Hard Rock) we park.
export const stakeAdapter = buildOffshoreProbeAdapter({
  slug: 'stake',
  name: 'Stake.us',
  seedUrl: 'https://stake.us',
  apiHostRegex: /\/(api|graphql|v\d+|sportsbook|casino|events|markets)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://stake.us/sports/basketball/nba',    leagueSlug: 'nba' },
    { url: 'https://stake.us/sports/baseball/mlb',      leagueSlug: 'mlb' },
    { url: 'https://stake.us/sports/ice-hockey/nhl',    leagueSlug: 'nhl' },
  ],
  useProxy: 'us-mobile',
  pollIntervalSec: 21600,  // 6h during discovery — high CF-block risk
})
