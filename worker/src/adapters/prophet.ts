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
  // allHosts diagnostic showed prophetexchange.com is a Framer
  // marketing site (most requests go to framerusercontent.com). The
  // actual betting app lives at prophetx.co which appeared as one of
  // the hosts the page talks to. Reseed there.
  seedUrl: 'https://www.prophetx.co',
  apiHostRegex: /\/(api|graphql|v\d+|rpc|public|markets|events|sports|book|trading)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://www.prophetx.co/sports/nba', leagueSlug: 'nba' },
    { url: 'https://www.prophetx.co/sports/mlb', leagueSlug: 'mlb' },
    { url: 'https://www.prophetx.co/sports/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,
})
