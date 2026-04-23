import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// BetParx via browser-session discovery.
//
// Earlier we tried replaying the Kambi /parx/ listView endpoint directly
// (as a KAMBI_OPERATORS entry) but it 429s at the endpoint layer on every
// IP class — datacenter, PacketStream CA, PacketStream US mobile — so
// that path is a dead end.
//
// Different approach: seed the actual betting SPA at play.betparx.com in
// Playwright. The app mints session cookies + x-anonymous-authorization
// style JWTs client-side, then fires its own GraphQL / REST calls that
// include those tokens. We passively capture every XHR.
//
// PA-licensed so the IP must geolocate to a US state Parx serves. Railway
// is US-hosted so direct IP is the first attempt; if the landing page
// returns a CF challenge or geo error we'll see it in the seed log and
// know to escalate to PROXY_URL_US.
export const betparxBrowserAdapter = buildOffshoreProbeAdapter({
  slug: 'betparx',
  name: 'BetParx',
  seedUrl: 'https://play.betparx.com/pa/sports',
  // Very broad — we don't yet know whether the SPA talks to
  // kambicdn.com, a parxcasino CDN, or an in-house API host. Capture
  // anything API-shaped.
  // First discovery returned distinctPaths=0 — broaden to catch any
  // API-shaped path on any host. Tighten once we see what surfaces.
  apiHostRegex: /\/(api|graphql|v\d+|offering|listView|sportsbook|eventList|event)(\/|\?|$)/i,
  leaguePaths: [
    { url: 'https://play.betparx.com/pa/sports/basketball/nba', leagueSlug: 'nba' },
    { url: 'https://play.betparx.com/pa/sports/baseball/mlb',   leagueSlug: 'mlb' },
    { url: 'https://play.betparx.com/pa/sports/hockey/nhl',     leagueSlug: 'nhl' },
  ],
  useProxy: false,
})
