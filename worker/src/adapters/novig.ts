import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Novig — US sports exchange. Front-end is React Native Web on app.novig.us.
// First discovery fire captured 43 hits to /v1/graphql — that's the Apollo
// endpoint powering every screen. Upgraded probe (captures POST bodies)
// will reveal the actual GraphQL queries on the next cycle so we can wire
// a real adapter. No CF-level IP gate observed — runs from direct IP.
export const novigAdapter = buildOffshoreProbeAdapter({
  slug: 'novig',
  name: 'Novig',
  seedUrl: 'https://app.novig.us',
  // Tight regex — the previous broad one matched every static asset. Only
  // capture the actual API calls: /v1/graphql (Apollo), /nbx/* (auth +
  // promo surfaces), and any other novig.us /api/ path that shows up.
  apiHostRegex: /novig\.(us|com).*\/(v\d+\/graphql|nbx\/|api\/)/i,
  leaguePaths: [
    { url: 'https://app.novig.us/nba', leagueSlug: 'nba' },
    { url: 'https://app.novig.us/mlb', leagueSlug: 'mlb' },
    { url: 'https://app.novig.us/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,   // direct Railway IP — Novig doesn't geo-gate
})
