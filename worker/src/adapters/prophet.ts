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
  apiHostRegex: /(prophet|graphql|api)[a-zA-Z0-9.-]*\/(api|v\d+|graphql|public|markets|events)/i,
  leaguePaths: [
    { url: 'https://prophetexchange.com/sports/nba', leagueSlug: 'nba' },
    { url: 'https://prophetexchange.com/sports/mlb', leagueSlug: 'mlb' },
    { url: 'https://prophetexchange.com/sports/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,   // exchanges don't geo-gate; direct Railway IP fine
})
