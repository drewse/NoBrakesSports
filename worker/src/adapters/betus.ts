import { buildOffshoreProbeAdapter } from './_offshore-probe.js'

// BetUS — Panama-licensed offshore. CF challenge page returned on curl
// probes through PacketStream US. Testing whether real Chrome clears it.
export const betusAdapter = buildOffshoreProbeAdapter({
  slug: 'betus',
  name: 'BetUS',
  seedUrl: 'https://www.betus.com.pa/sportsbook/',
  apiHostRegex: /betus\.com\.pa\/(api|services|sportsbook\/api)/i,
  leaguePaths: [
    { url: 'https://www.betus.com.pa/sportsbook/nba-basketball-lines', leagueSlug: 'nba' },
    { url: 'https://www.betus.com.pa/sportsbook/mlb-baseball-lines',   leagueSlug: 'mlb' },
    { url: 'https://www.betus.com.pa/sportsbook/nhl-hockey-lines',     leagueSlug: 'nhl' },
  ],
  pollIntervalSec: 7200,
})
