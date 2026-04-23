/**
 * Prophet Exchange — US sports order-book exchange (NJ/OH/IN).
 *
 * REST surface (captured via discovery):
 *   GET /trade/public/api/v1/events
 *     Paginated event list:
 *       { next: N, len: N,
 *         data: [{ name: "Knicks at Hawks",
 *                  sport:      { id, name },
 *                  tournament: { id, name },    // "NBA" / "MLB" / "NHL" / …
 *                  season:     { id, name },
 *                  startDate?, venue?, … }] }
 *   GET /trade/public/api/v1/events/:id  (per-event detail; probes below)
 *
 * Live price updates flow over Pusher WebSockets (cluster mt1, app_id
 * 1810913, key c975574818f436e8dd4a). The app subscribes to channels
 * keyed by market/event UUID. A subscriber adapter is a separate project
 * — for V1 we write Prophet's event roster + any embedded market lines
 * that come back on the REST side. Prices will backfill once the
 * subscriber lands.
 */

import { withPage } from '../lib/browser.js'
import type { BookAdapter } from '../lib/adapter.js'
import type { ScrapeResult, GameMarket, ScrapedEvent } from '../lib/types.js'

const SEED_URL = 'https://www.prophetx.co'

// Prophet's tournament.name → our league slug + sport.
const LEAGUE_MAP: Record<string, { leagueSlug: string; sport: string }> = {
  NBA:           { leagueSlug: 'nba',  sport: 'basketball' },
  MLB:           { leagueSlug: 'mlb',  sport: 'baseball'   },
  NHL:           { leagueSlug: 'nhl',  sport: 'ice_hockey' },
  NFL:           { leagueSlug: 'nfl',  sport: 'football'   },
  // Soccer leagues can be added here as needed.
}

interface ProphetEvent {
  id: string
  name: string
  tournamentName: string
  leagueSlug: string
  sport: string
  startTime: string
  homeTeam: string
  awayTeam: string
}

/** Parse "{away} at {home}" — Prophet's event-name convention. */
function parseMatchup(name: string): { home: string; away: string } | null {
  const parts = name.split(/\s+at\s+/i)
  if (parts.length !== 2) return null
  return { away: parts[0].trim(), home: parts[1].trim() }
}

function walkForProphetEvents(body: any, out: ProphetEvent[]) {
  const entries = Array.isArray(body?.data) ? body.data
    : Array.isArray(body) ? body
    : []
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    const id = e.id ?? e.eventId ?? e.uuid
    const name = e.name ?? e.displayName
    const tournamentName = e.tournament?.name ?? e.tournamentName
    if (!id || typeof name !== 'string' || !tournamentName) continue

    const league = LEAGUE_MAP[String(tournamentName).toUpperCase()]
    if (!league) continue   // skip soccer + unknown leagues for V1

    const matchup = parseMatchup(name)
    if (!matchup) continue

    const start = e.startDate ?? e.startTime ?? e.scheduledStart
    const startTime = typeof start === 'string'
      ? new Date(start).toISOString()
      : typeof start === 'number'
        ? new Date(start).toISOString()
        : null
    if (!startTime) continue

    out.push({
      id: String(id),
      name,
      tournamentName: String(tournamentName),
      leagueSlug: league.leagueSlug,
      sport: league.sport,
      startTime,
      homeTeam: matchup.home,
      awayTeam: matchup.away,
    })
  }
}

export const prophetAdapter: BookAdapter = {
  slug: 'prophet_exchange',
  name: 'Prophet Exchange',
  pollIntervalSec: 600,   // 10 min — events list is slow-moving, prices will
                          // come via WS subscriber once that lands
  needsBrowser: true,

  async scrape({ signal, log }) {
    if (signal.aborted) return { events: [], errors: ['aborted'] }

    return withPage(async (page) => {
      const errors: string[] = []
      const captured: ProphetEvent[] = []
      // seenPaths diagnostic showed the /trade/public/api/v1/events
      // endpoint isn't being hit on this cycle — the 22 WS frames + lack
      // of REST events suggest event + price data both flow over Pusher.
      // Capture frame payloads so we can see what Pusher actually carries.
      let wsFrameCount = 0
      const wsFrames: Array<{ wsUrl: string; payload: string }> = []
      const wsUrls = new Set<string>()

      page.on('websocket', (ws) => {
        const wsUrl = ws.url()
        wsUrls.add(wsUrl)
        let n = 0
        ws.on('framereceived', (data) => {
          wsFrameCount++
          n++
          if (wsFrames.length >= 25) return
          const payload = typeof data.payload === 'string'
            ? data.payload
            : Buffer.from(data.payload).toString('utf8')
          // Pusher sends an initial connection_established frame + pings
          // that aren't useful — keep only frames that look like data
          // messages (contain "event" or "data" substrings beyond the
          // first few bytes).
          if (payload.length > 60 || /"event"/.test(payload)) {
            wsFrames.push({ wsUrl, payload: payload.slice(0, 800) })
          }
        })
      })

      // Diagnostic: log the first 20 distinct prophetx-ish paths we see,
      // regardless of match — so if the /events endpoint moved we know.
      const seenPaths = new Set<string>()
      const pathStatuses: Array<{ path: string; status: number }> = []

      page.on('response', async (resp) => {
        const u = resp.url()
        try {
          const url = new URL(u)
          if (/prophetx\.co|prophet/i.test(url.host)) {
            const p = url.pathname
            if (!seenPaths.has(p) && seenPaths.size < 30) {
              seenPaths.add(p)
              pathStatuses.push({ path: p, status: resp.status() })
            }
          }
        } catch { /* ignore */ }
        if (resp.status() !== 200) return
        // Widen: match any path containing /events under /api/v1 or
        // /trade/public/api/v1 so we catch pagination suffixes, detail
        // endpoints, or a renamed route.
        if (!/\/(?:trade\/public\/)?api\/v\d+\/events/i.test(u)) return
        try {
          const body = await resp.json()
          walkForProphetEvents(body, captured)
        } catch { /* non-JSON */ }
      })

      try {
        await page.goto(SEED_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await page.waitForTimeout(4_000)
      } catch (e: any) {
        log.error('seed failed', { url: SEED_URL, message: e?.message ?? String(e) })
        errors.push(`seed: ${e?.message ?? String(e)}`)
        return { events: [], errors }
      }

      // Visit each league-specific page so the SPA's own event-list XHRs
      // fire for basketball / baseball / hockey.
      for (const path of ['/sports/nba', '/sports/mlb', '/sports/nhl', '/sports/nfl']) {
        if (signal.aborted) break
        try {
          await page.goto(SEED_URL + path, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          await page.waitForTimeout(3_500)
        } catch (e: any) {
          errors.push(`${path} nav: ${e?.message ?? String(e)}`)
        }
      }

      // Dedupe by ID (the SPA fires the same events call multiple times).
      const byId = new Map<string, ProphetEvent>()
      for (const ev of captured) if (!byId.has(ev.id)) byId.set(ev.id, ev)

      log.info('prophet capture', {
        rawCaptured: captured.length,
        uniqueEvents: byId.size,
        wsFrameCount,
        wsUrls: [...wsUrls],
        seenPaths: pathStatuses.slice(0, 30),
      })
      for (const f of wsFrames) {
        log.info('prophet ws frame', {
          wsUrl: f.wsUrl.slice(0, 120),
          len: f.payload.length,
          preview: f.payload,
        })
      }

      // V1 writes events only — prices pending Pusher subscriber. Emit
      // one ScrapedEvent per captured game with empty gameMarkets/props.
      // Writer auto-creates the event row if it doesn't already exist so
      // it's ready to join markets once the price adapter lands.
      const scraped: ScrapedEvent[] = []
      const perLeague: Record<string, number> = {}
      for (const ev of byId.values()) {
        perLeague[ev.leagueSlug] = (perLeague[ev.leagueSlug] ?? 0) + 1
        scraped.push({
          event: {
            externalId: ev.id,
            homeTeam: ev.homeTeam,
            awayTeam: ev.awayTeam,
            startTime: ev.startTime,
            leagueSlug: ev.leagueSlug,
            sport: ev.sport,
          },
          gameMarkets: [] as GameMarket[],
          props: [],
        })
      }

      log.info('prophet output', { emitted: scraped.length, perLeague })
      return { events: scraped, errors }
    }, { useProxy: false })
  },
}
