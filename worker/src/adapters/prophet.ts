import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Prophet Exchange — US sports order-book exchange (NJ/OH/IN). Same
// pattern as Novig: front-end is an SPA that fires its own API calls,
// direct Railway IP works fine (no CF geo-gate observed).
//
// Discovery goal: capture the real API host(s) + representative endpoint
// paths + first sample bodies so the next iteration wires a real parser.
export const prophetAdapter = buildOffshoreProbeAdapter({
  slug: 'prophet_exchange',
  name: 'Prophet Exchange',
  seedUrl: 'https://prophetexchange.com',
  // First discovery returned distinctPaths=0 — the regex was too
  // narrow. Catch anything that looks like an API call on any host,
  // so we can see where Prophet's front-end actually talks to.
  apiHostRegex: /\/(api|graphql|v\d+|rpc|public|markets|events|sports|book|trading)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://prophetexchange.com/sports/nba', leagueSlug: 'nba' },
    { url: 'https://prophetexchange.com/sports/mlb', leagueSlug: 'mlb' },
    { url: 'https://prophetexchange.com/sports/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,
})
