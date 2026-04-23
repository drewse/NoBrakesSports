import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// Circa Sports — Vegas sharp book, NV-primary with a handful of other
// states. Homepage HTML returned 200 direct; the dedicated API host
// (api.circasports.com) 403s on curl but may be just CF bot-detection on
// non-browser TLS. Discovery via direct Railway Chromium to see whether
// the SPA's own fetch can reach it.
export const circaAdapter = buildOffshoreProbeAdapter({
  slug: 'circa_sports',
  name: 'Circa Sports',
  seedUrl: 'https://www.circasports.com',
  apiHostRegex: /(circasports|cgtechnology|betcg)[a-zA-Z0-9.-]*\//i,
  leaguePaths: [
    { url: 'https://www.circasports.com/sports/basketball', leagueSlug: 'nba' },
    { url: 'https://www.circasports.com/sports/baseball',   leagueSlug: 'mlb' },
    { url: 'https://www.circasports.com/sports/hockey',     leagueSlug: 'nhl' },
  ],
  useProxy: false,   // direct Railway IP — probe first before deciding on proxy escalation
})
