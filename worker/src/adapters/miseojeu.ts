import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Miseojeu — Loto-Québec's sportsbook, QC-only. First discovery exited
// in 330 ms silently; the helper now logs the actual seed error. The
// site redirects root → /fr/accueil but the betting UI lives under
// /fr/offre-de-paris/tous-les-sports (grepped from the front-page HTML).
// CA residential proxy keeps the request inside Canada which the QC
// operator expects.
export const miseojeuAdapter = buildOffshoreProbeAdapter({
  slug: 'miseojeu',
  name: 'Miseojeu',
  seedUrl: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/tous-les-sports',
  apiHostRegex: /(lotoquebec|miseojeu|bragg|openbet|scientificgames)[a-zA-Z0-9.-]*\/(api|v\d+|offer|sport)/i,
  leaguePaths: [
    { url: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/basketball', leagueSlug: 'nba' },
    { url: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/baseball',   leagueSlug: 'mlb' },
    { url: 'https://miseojeu.lotoquebec.com/fr/offre-de-paris/hockey-sur-glace', leagueSlug: 'nhl' },
  ],
  // PacketStream CA didn't clear Loto-Québec's edge. IPRoyal CA mobile
  // keeps us inside Canada on a carrier IP the QC operator expects.
  useProxy: 'mobile',
  pollIntervalSec: 7200,
})
