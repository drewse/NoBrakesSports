# NoBrakes Sports — Feature Roadmap

## Current State (April 17, 2026)

### Infrastructure
- **Stack**: Next.js 15, Supabase Pro, Vercel Pro, PacketStream proxy
- **Sync**: Every 2 minutes via Vercel cron (`sync-props` route)
- **Odds refresh**: ~2 min polling (all books scraped in parallel)

### Books Live (12)
| Book | Game Lines | Props | Notes |
|------|-----------|-------|-------|
| BetRivers (Kambi) | ✅ ML/Spread/Total | ✅ Full (all sports) | |
| Unibet (Kambi) | ✅ | ✅ Full | |
| LeoVegas (Kambi) | ✅ | ✅ Full | |
| NorthStar Bets (Kambi) | ✅ | ✅ Full | |
| Pinnacle | ✅ | ✅ Full | Via proxy |
| FanDuel | ✅ | ✅ Full (6 tabs) | Pts, Reb, Ast, 3PM, Combos, Defense |
| BetMGM (Entain) | ✅ | ✅ Full (all sports) | |
| bwin (Entain) | ✅ | ✅ Full | |
| partypoker (Entain) | ✅ | ✅ Full | |
| Betway | ✅ | ✅ Full (per-event) | GetEventDetails endpoint |
| DraftKings | ✅ | ❌ 0 props | Per-event endpoint untested via proxy |
| PointsBet | ❌ 0 (Cloudflare) | ❌ 0 | Blocked — needs Playwright or WS |

### Features Built
- ✅ +EV detection (Pinnacle-first fair prob, power devig, prop +EV)
- ✅ Prop arb detection (unified with game arbs, paginated to 20k rows)
- ✅ Arb calculator (AVO-style two-panel, Kelly criterion)
- ✅ Discord webhook alerts (arbs ≥ 0.5%, +EV ≥ 3%)
- ✅ Change detection (odds_hash, only write when odds move)
- ✅ Event matching (canonicalEventKey, sorted teams, nickname fallback)

---

## Priority Order

| # | Feature | Impact | Effort | Why |
|---|---------|--------|--------|-----|
| 1 | Fix DraftKings props | 🔴 Critical | Low | 0 props from a major book — missing arbs |
| 2 | Add missing Ontario books | 🔴 Critical | Medium | bet365/Betano/theScore = more arb surface |
| 3 | Real-time WebSocket odds | 🟢 High | High | Sub-5s refresh, catch arbs before they close |
| 4 | Player name normalization | 🟡 Medium | Low | Cross-book mismatches reduce arb detection |
| 5 | EV/Arb filters & auto-refresh | 🟡 Medium | Low | UX — filter by sport/book/%, auto-poll |
| 6 | In-app alert badges | 🟡 Medium | Low | Sidebar notification when arbs/EV detected |
| 7 | Event dedup periodic job | 🟡 Medium | Medium | Merge duplicate events automatically |
| 8 | Email alerts (Pro feature) | 🟡 Medium | Medium | Paid feature for monetization |

---

## 1. Fix DraftKings Props

### Problem
DK's API requires a subcategory filter on the league-level markets endpoint. The unfiltered query returns 0 markets. The per-event `/v1/events/{id}` endpoint is deployed but untested through the proxy.

### Options
a) **Discover prop subcategory IDs** — user opens DK → player props tab → DevTools → copy the subcategoryId from the API call. Then add those IDs to `DK_LEAGUES` config.
b) **Try different per-event endpoints** — `/v2/event-page?eventId={id}`, `/v1/eventgroups/{leagueId}/events/{eventId}`
c) **Use DK's category navigation endpoint** — discover all subcategories dynamically

### Files
- `lib/pipelines/adapters/draftkings-props.ts`

---

## 2. Add Missing Ontario Books

### Books AVO Has That We Don't

| Book | API Status | Approach |
|------|-----------|----------|
| **bet365** | Cloudflare WAF | Need residential proxy + browser headers, or WS |
| **Betano** | Not attempted | Investigate API — likely Kaizen Gaming platform |
| **Proline+ (OLG)** | Not attempted | Ontario government book — may have public API |
| **theScore Bet** | Not attempted | Penn Entertainment — similar to ESPN Bet API |
| **Caesars** | Session auth required | Needs cookie/token extraction |
| **Sports Interaction** | Not attempted | Kambi-powered — may work with existing adapter |

### Priority
1. **Sports Interaction** — if Kambi-powered, can reuse existing adapter (add operator)
2. **Betano** — investigate API, likely scrapeable
3. **Proline+** — government book, often has soft lines (arb goldmine)
4. **theScore Bet** — large Ontario market share
5. **bet365 / Caesars** — hardest to access, save for last

---

## 3. Real-Time WebSocket Odds (Sub-5s Refresh)

### Goal
Replace 2-minute polling with persistent WebSocket connections for instant odds updates.

### Architecture
```
┌──────────────────────────────────┐
│  Railway/Fly.io ($5-7/mo)       │
│  Persistent Node.js worker      │
│                                 │
│  ┌─────┐ ┌──────┐ ┌──────┐    │
│  │Kambi│ │FanDuel│ │Betway│    │ ← WebSocket/SSE connections
│  │ SSE │ │ SSE  │ │SignalR│    │
│  └──┬──┘ └──┬───┘ └──┬───┘    │
│     │       │        │         │
│     └───────┴────────┘         │
│             │                  │
│      Supabase write on         │
│      every odds change         │
└─────────────┬──────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  Supabase Realtime              │
│  Broadcasts table changes       │
└─────────────┬──────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  Next.js Frontend               │
│  useEffect → subscribe to       │
│  current_market_odds changes    │
│  UI updates in <1 second        │
└──────────────────────────────────┘
```

### Book WebSocket Protocols

| Book | Protocol | Difficulty |
|------|----------|------------|
| Kambi (×4) | Push API / SSE | Easy — documented |
| FanDuel | SSE (Server-Sent Events) | Easy |
| DraftKings | Pusher WebSocket | Medium — reverse WS handshake |
| Betway | SignalR (WebSocket) | Medium — .NET protocol |
| Entain (×3) | WebSocket | Medium — CDS push feed |
| Pinnacle | REST only | Poll every 15-30s |
| PointsBet | WebSocket + Cloudflare | Hard |

### Implementation Steps
1. Set up Railway/Fly.io persistent worker
2. Reverse-engineer WS protocols (need user to capture WS frames from DevTools)
3. Build reconnection + error handling for each book
4. Write to Supabase on every odds change
5. Add Supabase Realtime subscription to frontend
6. Replace Vercel cron with worker-based continuous scraping

### Cost
- Railway/Fly.io: ~$5-7/mo
- Supabase Realtime: included in Pro plan
- Eliminates Vercel cron dependency

---

## 4. Player Name Normalization

### Problem
Cross-book player name mismatches reduce arb detection. "Wendell Carter Jr" (Kambi) vs "Wendell Carter JR" (Betway) vs "W. Carter Jr." (DK) won't match.

### Solution
- Build a master alias table for known mismatches
- Improve `normalizePlayerName()`: handle Jr/Sr/III suffixes, strip team abbreviations
- Log unmatched player names for manual review
- Fuzzy matching fallback (Levenshtein distance < 3)

### Files
- `lib/pipelines/prop-normalizer.ts`

---

## 5. EV/Arb Filters & Auto-Refresh

### Features
- Filter by: league, market type (ML/spread/total/prop), minimum EV%, book
- Sort by: EV%, profit%, probability, event start time
- "Fresh only" toggle: hide lines older than X minutes
- Auto-refresh: poll every 30s and update table without full page reload
- "NEW" badge on opportunities that appeared in the last scan

### Files
- `app/(app)/arbitrage/arb-calculator-client.tsx`
- `app/(app)/top-lines/page.tsx`

---

## 6. In-App Alert Badges

### Features
- Sidebar badge showing count of active arbs/+EV opportunities
- `opportunities` table tracking detected opportunities with expiry
- Badge updates on every sync cycle

---

## 7. Event Dedup Periodic Job

### Problem
Different books sometimes create separate events for the same game due to team name or timing differences. While current matching works well (10/10 books for most NBA games), edge cases persist.

### Solution
- SQL function that finds and merges duplicate events hourly
- Match by: league + sorted team nicknames + date (±4hr window)
- Merge: move all odds/props to canonical event, delete duplicate
- Run as part of sync-props (hourly, not every 2 min)

---

## 8. Email Alerts (Pro Feature)

### Features
- User-configurable alert preferences in Account settings
- Minimum EV%/arb% thresholds, sport/league filters
- Frequency: immediate, 15-min digest, daily summary
- Resend/SendGrid for transactional email
- Pro-tier monetization feature

---

## Suggested Sprint Plan

**Sprint 1 (next session): Quick Wins**
- Fix DraftKings props (discover subcategory IDs via DevTools)
- Switch cron to 1-minute interval (free on Vercel Pro)
- Player name normalization improvements

**Sprint 2 (1-2 sessions): More Books**
- Add Sports Interaction (Kambi operator — may be trivial)
- Investigate Betano, Proline+, theScore Bet APIs
- Add any that are accessible

**Sprint 3 (2-3 sessions): Real-Time Foundation**
- Set up Railway/Fly.io worker
- Implement Kambi SSE + FanDuel SSE (easiest two)
- Add Supabase Realtime subscription to frontend
- Test sub-5s odds refresh

**Sprint 4 (2-3 sessions): Real-Time Expansion**
- Reverse-engineer DraftKings Pusher WS
- Reverse-engineer Betway SignalR
- Reverse-engineer Entain CDS WebSocket
- Full real-time coverage across all books

**Sprint 5 (1-2 sessions): Polish & Monetize**
- EV/Arb filters, auto-refresh UI
- In-app alert badges
- Email alerts (Pro feature)
- Event dedup periodic job
