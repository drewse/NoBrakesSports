/**
 * Bet99 (Ontario) — PARKED. DGC / SBTech encoded WebSocket protocol.
 *
 * Full reconnaissance done 2026-04-27 with a real authenticated
 * session (`ats_token` cookie). Findings:
 *
 *   1. Production host is on.bet99.ca (NOT www.bet99.com).
 *   2. Auth: POST /sportsbook/v1/api/singleSignOnLogin with the
 *      ats_token cookie returns 200 + user account JSON. The same
 *      cookie successfully upgrades the WebSocket handshake to
 *      wss://on.bet99.ca/sportsbook-streaming-ws/ (HTTP 101).
 *   3. Wire protocol after login is ENCODED. The first sent frame is
 *      a plain-JSON SportsbookLoginRequest envelope; the server
 *      replies with a plain-JSON Response/KeepAlive. After that,
 *      every data frame the server pushes is shaped:
 *        { "Code": 1, "Body": "<opaque base64-ish blob>" }
 *      The body is almost certainly a session-derived AES envelope
 *      around a Protobuf/MessagePack payload. DGC ships the encoding
 *      to defeat third-party scraping; nothing in the bundled JS is
 *      decompilable into a stable decoder in tractable time.
 *   4. There is NO REST data surface — every /sportsbook/v1/api/...
 *      data path 404s; the only unauthenticated REST endpoint is
 *      /sportsbook/api/public/icons. /ats-node/* returns the SPA
 *      shell (HTML 4169 bytes).
 *
 * Why we're parked, not retrying:
 *   - Reverse-engineering the Code:1 envelope is a 1–2 week
 *     low-level effort, fragile across DGC platform updates, and
 *     produces a single book of marginal value (Bet99's lines mirror
 *     BetMGM ON / bwin / partypoker which we already scrape).
 *   - The realistic path to Bet99 lines is a partner data feed
 *     (OpticOdds / Sportradar / similar), not direct scraping.
 *
 * Adapter behavior:
 *   No-op. Returns 0 events without opening a browser. We don't
 *   burn IPRoyal bandwidth on an adapter that can't produce data.
 *   Re-enable by replacing this body with a typed WS subscriber
 *   once a Code:1 decoder is in hand.
 */

import type { BookAdapter } from '../lib/adapter.js'

export const bet99Adapter: BookAdapter = {
  slug: 'bet99',
  name: 'Bet99 (Ontario) [parked]',
  // Day cadence is a no-op anyway; keeps the adapter visible on the
  // pipelines page without scheduler churn.
  pollIntervalSec: 86400,
  needsBrowser: false,

  async scrape() {
    // See header comment for the full protocol writeup. TL;DR: DGC
    // platform encodes every data frame after login (Code:1 envelope,
    // session-derived encryption). Reverse-engineering the decoder is
    // 1–2 weeks of brittle work for one book whose lines mirror
    // BetMGM ON / bwin / partypoker which we already scrape.
    return { events: [], errors: [] }
  },
}
