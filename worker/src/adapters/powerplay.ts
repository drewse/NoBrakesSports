import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// PowerPlay — Ontario-licensed book. Not CF-blocked at the curl level.
// First discovery attempt exited in 358 ms with a silent seed error; the
// helper now surfaces the actual Playwright exception in the log so next
// fire tells us whether it's a tunnel error, a geo-block, or a nav
// issue. Routes through CA residential to match the geo-license
// expectation.
export const powerplayAdapter = buildOffshoreProbeAdapter({
  slug: 'powerplay',
  name: 'PowerPlay',
  // Try the .ca domain first — .com redirects via Azure gateway which may
  // have been what was failing on goto. If .ca also fails the improved
  // error logging will tell us.
  seedUrl: 'https://www.powerplay.ca',
  // Tight regex — skip static assets, match only API-shaped paths on any
  // plausible backend platform. If discovery shows empty we can widen.
  apiHostRegex: /(powerplay|kambicdn|americanwagering|sbtech|gan-gaming|openbet|playtech)[a-zA-Z0-9.-]*\/(api|v\d+|offering|listView|sportsbook)\//i,
  leaguePaths: [
    { url: 'https://www.powerplay.ca/sports/basketball', leagueSlug: 'nba' },
    { url: 'https://www.powerplay.ca/sports/baseball',   leagueSlug: 'mlb' },
    { url: 'https://www.powerplay.ca/sports/hockey',     leagueSlug: 'nhl' },
  ],
  // PacketStream CA got TCP-dropped here too. IPRoyal CA mobile clears
  // the CF reputation wall that residential CIDRs hit.
  useProxy: 'mobile',
  pollIntervalSec: 7200,
})
