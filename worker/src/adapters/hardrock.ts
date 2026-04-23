/**
 * Hard Rock Bet — discovery-mode probe using the shared helper.
 *
 * Earlier custom adapter used a tight regex (`app.hardrock.bet/api/`)
 * that matched zero responses. Rewriting to use buildOffshoreProbeAdapter
 * gives us allHosts logging + sample body/request capture so we can see
 * exactly where the app talks to — same flow that unlocked Novig and
 * revealed Prophet's Pusher subscription.
 *
 * When the next discovery cycle runs we'll see in logs:
 *   - allHosts: every host the SPA hit (API backend likely here)
 *   - topPaths: API path patterns by frequency
 *   - offshore sample body: first 2 KB of each distinct JSON response
 * and wire the real parser on iteration 2.
 */

import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

export const hardRockAdapter = buildOffshoreProbeAdapter({
  slug: 'hard_rock_bet',
  name: 'Hard Rock Bet',
  seedUrl: 'https://app.hardrock.bet/sports',
  // Match any path on Hard Rock's actual API backends (first probe
  // revealed api.hardrocksportsbook.com + app.hardrock.bet as the real
  // hosts) — plus path-shape fallback for anything else that looks like
  // an API call.
  apiHostRegex: /(?:api|evs|cdn)\.hardrocksportsbook\.com|app\.hardrock\.bet\/(?:api|sportsbook)|\/(?:api|graphql|v\d+|markets|events|offering|sportsbook)(?:\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://app.hardrock.bet/sports/basketball/nba', leagueSlug: 'nba' },
    { url: 'https://app.hardrock.bet/sports/baseball/mlb',   leagueSlug: 'mlb' },
    { url: 'https://app.hardrock.bet/sports/hockey/nhl',     leagueSlug: 'nhl' },
    { url: 'https://app.hardrock.bet/sports/football/nfl',   leagueSlug: 'nfl' },
  ],
  useProxy: 'us-mobile',
  pollIntervalSec: 7200,  // 2h during discovery
})
