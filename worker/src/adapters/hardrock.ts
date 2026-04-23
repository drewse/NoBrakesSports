/**
 * Hard Rock Bet — PARKED (requires authenticated session).
 *
 * Full discovery showed an anonymous browse only hits teaser/parlay
 * endpoints (/sportsbook/api/public/teaser/*) and error telemetry
 * (/api/:id/envelope/ → Sentry). The real odds backend lives behind
 * api.hardrocksportsbook.com with only 4 handshake hits and no usable
 * event list — that's where authenticated user sessions pull odds.
 *
 * Same gate as other US state-regulated books (FanDuel US, BetMGM US,
 * DK US): they require a logged-in account to see odds. Unanonymous
 * scraping unlocks only teaser metadata. Parking until we have a
 * real auth flow.
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
  pollIntervalSec: 21600,  // 6h while parked pending auth flow
})
