import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Novig — US sports exchange. Front-end is React Native Web (`app.novig.us`
// serves the SPA at /api/events too, since paths are client-routed). Real
// API host is obfuscated in the JS bundle; discovery captures it.
// No CF-level IP gate observed on any probe — runs from direct Railway IP.
export const novigAdapter = buildOffshoreProbeAdapter({
  slug: 'novig',
  name: 'Novig',
  seedUrl: 'https://app.novig.us',
  apiHostRegex: /(novig|graphql|api|gateway)[a-zA-Z0-9.-]*\//i,
  leaguePaths: [
    { url: 'https://app.novig.us/nba', leagueSlug: 'nba' },
    { url: 'https://app.novig.us/mlb', leagueSlug: 'mlb' },
    { url: 'https://app.novig.us/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,   // direct Railway IP — Novig doesn't geo-gate
})
