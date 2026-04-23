import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// PowerPlay — Ontario-licensed book. Not CF-blocked from direct fetch or
// CA residential. Platform unknown (Kambi / SBTech / proprietary — the
// homepage HTML is SPA-only so we need browser discovery to see the
// real API host). Runs through CA residential (PROXY_URL) to match the
// geo-license expectation.
export const powerplayAdapter = buildOffshoreProbeAdapter({
  slug: 'powerplay',
  name: 'PowerPlay',
  seedUrl: 'https://on.powerplay.com',
  // Very loose regex — we don't know the API host yet, so capture every
  // JSON XHR under the same domain family or any known platform CDN.
  apiHostRegex: /(powerplay|kambicdn|americanwagering|sbtech|gan|openbet|playtech)[a-zA-Z0-9.-]*\//i,
  leaguePaths: [
    { url: 'https://on.powerplay.com/sports/basketball', leagueSlug: 'nba' },
    { url: 'https://on.powerplay.com/sports/baseball',   leagueSlug: 'mlb' },
    { url: 'https://on.powerplay.com/sports/hockey',     leagueSlug: 'nhl' },
  ],
  useProxy: true,   // PacketStream CA residential
})
