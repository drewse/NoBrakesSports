import { createLogger } from './lib/logger.js'
import { startScheduler, type BookAdapter } from './lib/adapter.js'
import { startHealthServer } from './lib/health-server.js'
import { shutdownBrowser } from './lib/browser.js'
import { getSupabase } from './lib/supabase.js'

// Registered adapters. Add more here as you port/build them.
import { pointsbetAdapter } from './adapters/pointsbet.js'
import { pinnacleAdapter } from './adapters/pinnacle.js'
import { bet365Adapter } from './adapters/bet365.js'
import { caesarsAdapter } from './adapters/caesars.js'
import { betmgmAdapter } from './adapters/betmgm.js'
import { prolineAdapter } from './adapters/proline.js'
import { thescoreAdapter } from './adapters/thescore.js'
import { betvictorAdapter } from './adapters/betvictor.js'
import { bet99Adapter } from './adapters/bet99.js'
import { eightyEightSportAdapter } from './adapters/eightyeightsport.js'
import { betanoAdapter } from './adapters/betano.js'
import { tonybetAdapter } from './adapters/tonybet.js'
import { ballybetAdapter } from './adapters/ballybet.js'
import { betonlineAdapter, lowvigAdapter, sportsbettingAgAdapter } from './adapters/betonline.js'
import { hardRockAdapter } from './adapters/hardrock.js'
import { mybookieAdapter } from './adapters/mybookie.js'
import { bookmakerEuAdapter } from './adapters/bookmaker-eu.js'
import { betusAdapter } from './adapters/betus.js'
import { powerplayAdapter } from './adapters/powerplay.js'
import { miseojeuAdapter } from './adapters/miseojeu.js'
import { novigAdapter } from './adapters/novig.js'
import { circaAdapter } from './adapters/circa.js'
import { prophetAdapter } from './adapters/prophet.js'
import { betparxBrowserAdapter } from './adapters/betparx-browser.js'
import { titanplayAdapter } from './adapters/titanplay.js'
import { sportzinoAdapter } from './adapters/sportzino.js'
import { betovoAdapter } from './adapters/betovo.js'
import { stakeAdapter } from './adapters/stake.js'
import { sportsInteractionAdapter } from './adapters/sports-interaction.js'

// Removed:
//   fanduel_on   — handled by the Vercel pipeline (fanduel-props.ts)
//   betrivers_on — handled by the Vercel pipeline (kambi)
//   jackpotbet   — domain is parked/dead (confirmed via discovery log)
//   casumo       — Casumo CA has no sportsbook product, confirmed 2026-04-22
// Temporarily disabled to cut mobile-proxy spend until we have paying users:
//   caesars       — IPRoyal CA mobile, 1h cadence (~990 MB/week)
//   thescore      — IPRoyal CA mobile, 1h cadence (~275 MB/week)
//   betvictor     — IPRoyal CA mobile (~465 MB/week)
//   hard_rock_bet — IPRoyal US mobile, discovery-only (~237 MB/week)
// Re-enable by uncommenting from ALL_ADAPTERS below.
const ALL_ADAPTERS: BookAdapter[] = [
  pointsbetAdapter,
  pinnacleAdapter,
  bet365Adapter,
  // caesarsAdapter,      // disabled — mobile-tier burn
  betmgmAdapter,
  prolineAdapter,
  // thescoreAdapter,     // disabled — mobile-tier burn
  // betvictorAdapter,    // disabled — mobile-tier burn
  bet99Adapter,
  eightyEightSportAdapter,
  betanoAdapter,
  tonybetAdapter,
  ballybetAdapter,
  // US-geo proxied books. All activate automatically once PROXY_URL_US
  // (PacketStream — free tier, worth trying first) or MOBILE_PROXY_URL_US
  // (IPRoyal mobile — paid escalation) is set on Railway. First-deploy
  // logs tell us which books clear CF with PacketStream + real Chromium
  // vs. which need the mobile escalation.
  betonlineAdapter,           // BetOnline API — adapter fully parsed, ready for live data
  lowvigAdapter,              // LowVig — same SAS platform
  sportsbettingAgAdapter,     // Sportsbetting.ag — same SAS platform
  // hardRockAdapter,         // disabled — mobile-tier burn, discovery only
  mybookieAdapter,            // MyBookie.ag — discovery mode
  bookmakerEuAdapter,         // Bookmaker.eu — discovery mode
  betusAdapter,               // BetUS Panama — discovery mode
  // Non-CF-blocked discovery adapters — run without IPRoyal mobile
  powerplayAdapter,           // Ontario — PacketStream CA + Chromium
  miseojeuAdapter,            // Loto-Québec — PacketStream CA + Chromium
  novigAdapter,               // US prediction exchange — direct Railway IP (LIVE)
  circaAdapter,               // Circa Sports NV — direct Railway IP
  prophetAdapter,             // Prophet Exchange NJ/OH/IN — direct Railway IP
  betparxBrowserAdapter,      // BetParx PA — browser session at play.betparx.com
  // New discovery probes — direct IP + CA residential where possible
  titanplayAdapter,           // TitanPlay (Ontario) — direct Railway IP
  sportzinoAdapter,           // Sportzino (US sweeps) — direct Railway IP
  betovoAdapter,              // Betovo (CA) — PacketStream CA residential
  stakeAdapter,               // Stake.us (CF-gated sweeps) — IPRoyal US mobile
  sportsInteractionAdapter,   // Sports Interaction CA — Entain CDS via PacketStream
]

const log = createLogger('main')

async function main() {
  // Validate env
  getSupabase() // throws if env missing

  // Filter by ENABLED_BOOKS if set
  const enabledSet = process.env.ENABLED_BOOKS
    ? new Set(process.env.ENABLED_BOOKS.split(',').map(s => s.trim()).filter(Boolean))
    : null
  const adapters = enabledSet
    ? ALL_ADAPTERS.filter(a => enabledSet.has(a.slug))
    : ALL_ADAPTERS

  if (adapters.length === 0) {
    log.error('no adapters enabled — exiting')
    process.exit(1)
  }

  log.info('starting worker', {
    adapters: adapters.map(a => a.slug),
    node: process.version,
    build: 'v2-writer-verbose',
  })

  // Start health server so Railway's probe passes
  const port = parseInt(process.env.PORT ?? '8080', 10)
  const health = startHealthServer(port)

  // Start the scheduler (kicks off each adapter)
  const stopScheduler = startScheduler(adapters)

  // Graceful shutdown
  async function shutdown(signal: string) {
    log.info('shutdown received', { signal })
    try { await stopScheduler() } catch { /* ignore */ }
    try { await shutdownBrowser() } catch { /* ignore */ }
    try { health.close() } catch { /* ignore */ }
    setTimeout(() => process.exit(0), 2_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))

  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { reason: String(reason) })
  })
  process.on('uncaughtException', (err) => {
    log.error('uncaughtException', { message: err.message, stack: err.stack })
  })
}

main().catch(err => {
  console.error('fatal error during boot:', err)
  process.exit(1)
})
