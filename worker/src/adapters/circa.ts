import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Circa Sports — Vegas sharp book, NV-primary. First discovery attempt
// used www.circasports.com which turned out to be a WordPress marketing
// site (captured /wp-content/plugins/... assets, no betting XHRs). The
// actual betting app lives at betcirca.com (200 direct, no subdomain
// redirects). Reseeded there; discovery will show us the real API host.
export const circaAdapter = buildOffshoreProbeAdapter({
  slug: 'circa_sports',
  name: 'Circa Sports',
  seedUrl: 'https://betcirca.com',
  // Broad on first pass — we don't yet know whether betcirca.com talks to
  // itself or to a separate API host. Tighten after discovery.
  apiHostRegex: /(circa|betcirca|cgtechnology|betcg|kambi)[a-zA-Z0-9.-]*\/(api|v\d+|graphql|listView)/i,
  leaguePaths: [
    { url: 'https://betcirca.com/nba', leagueSlug: 'nba' },
    { url: 'https://betcirca.com/mlb', leagueSlug: 'mlb' },
    { url: 'https://betcirca.com/nhl', leagueSlug: 'nhl' },
  ],
  useProxy: false,
})
