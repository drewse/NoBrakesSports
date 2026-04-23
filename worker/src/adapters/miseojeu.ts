import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Miseojeu — Loto-Québec's sportsbook, QC-only. Government operator, no
// Cloudflare. Direct Railway IP should be fine but CA residential helps
// guarantee QC geolocation. Platform is likely Bragg/OpenBet; discovery
// pass will capture the API host pattern.
export const miseojeuAdapter = buildOffshoreProbeAdapter({
  slug: 'miseojeu',
  name: 'Miseojeu',
  seedUrl: 'https://miseojeu.lotoquebec.com/fr/accueil',
  apiHostRegex: /(lotoquebec|miseojeu|bragg|openbet|scientificgames)[a-zA-Z0-9.-]*\//i,
  leaguePaths: [
    { url: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/basketball', leagueSlug: 'nba' },
    { url: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/baseball',   leagueSlug: 'mlb' },
    { url: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/hockey',     leagueSlug: 'nhl' },
  ],
  useProxy: true,   // CA residential — QC operator expects CA traffic
})
