# NoBrakes Sports — Feature Roadmap

## Current State (April 2026)
- **12 live books**: BetRivers, Unibet, LeoVegas, NorthStar Bets (Kambi), DraftKings, FanDuel, Pinnacle, PointsBet, Betway, BetMGM, bwin, partypoker
- **Game-level markets**: ML, Spread, Total across all 12 books
- **Player props**: O/U Points, Rebounds, Assists, 3PM, PRA from 4 Kambi books + FanDuel Points
- **Sync frequency**: Every 2 minutes (game + props), every 5 minutes (Pinnacle pipeline)
- **Infrastructure**: Supabase Pro, Vercel Pro, PacketStream proxy

---

## 1. +EV Detection Engine

### Goal
Surface every bet where a soft book's price exceeds the fair probability — using Pinnacle as the sharp reference. This is the core money-making feature.

### How It Works
```
Fair Prob = power_devig(Pinnacle home_implied, away_implied)
EV% = (fair_prob × decimal_odds - 1) × 100

If EV% > 0 → positive expected value bet
If EV% > 2% → strong +EV opportunity
```

### Current State
- Top EV Lines page exists (`app/(app)/top-lines/page.tsx`)
- Queries `current_market_odds` for ML, spread, total
- Power devig + Pinnacle-first fair probability calculation implemented
- Shows podium (top 3) + full table

### What Needs to Be Done

#### a) Verify Pinnacle Data is Feeding into EV Calculations
- [ ] Confirm Pinnacle rows exist in `current_market_odds` for upcoming events
- [ ] Confirm the EV page finds Pinnacle as `source.slug === 'pinnacle'` and uses it for fair probs
- [ ] If Pinnacle is missing for an event, fall back to weighted consensus of all available books

#### b) Add Prop +EV Detection
- [ ] Query `prop_odds` alongside `current_market_odds`
- [ ] For each player prop (e.g., "LeBron Points O/U 25.5"):
  - Get Kambi prices from BetRivers, Unibet, LeoVegas, NorthStar
  - Get FanDuel price
  - Use sharpest line (closest to -110/-110) as fair reference
  - Flag any book where over_price or under_price gives +EV vs fair
- [ ] Display prop +EV lines in the same table as game-level lines
- [ ] Add "Prop" badge to distinguish from game-level EV

#### c) Improve EV Accuracy
- [ ] Use Pinnacle's no-vig line as the gold standard (power devig with k-solver)
- [ ] For props where Pinnacle isn't available, use Kambi consensus (4 operators)
- [ ] Filter out stale odds (>30 min) from EV calculations
- [ ] Add "confidence" indicator: high (Pinnacle reference), medium (consensus), low (2 books only)

#### d) Kelly Criterion Calculator
- [ ] For each +EV line, compute Kelly stake recommendation
- [ ] `Kelly% = (EV × bankroll) / (decimal_odds - 1)`
- [ ] Display as "Suggested stake: 2.3% of bankroll" alongside each line
- [ ] Add user-configurable bankroll setting (stored in profile or cookie)

#### e) EV Filters & Sorting
- [ ] Filter by: league, market type (ML/spread/total/prop), minimum EV%, book
- [ ] Sort by: EV%, probability, event start time
- [ ] "Fresh only" toggle: hide lines older than X minutes

### Files to Modify
- `app/(app)/top-lines/page.tsx` — main EV page, add prop queries + filters
- `lib/utils.ts` — add Kelly calculator function
- May need a new component for prop EV rows

---

## 2. Prop Arbitrage Detection

### Goal
Find over/under arbitrage opportunities across books on player props. These are more common than game-level arbs because prop lines vary significantly between books.

### How It Works
```
Book A: LeBron Points Over 25.5 at +110 → implied 47.6%
Book B: LeBron Points Under 25.5 at -105 → implied 51.2%
Combined: 47.6% + 51.2% = 98.8% → 1.2% profit

Arb exists when combined implied probability < 100%
```

### Current State
- Prop arb detection exists in `app/(app)/arbitrage/page.tsx`
- Queries `prop_odds` for O/U props with >2 books
- Finds best over from one book vs best under from another
- Merged into unified arb table with game arbs

### What Needs to Be Done

#### a) Increase Prop Coverage for Better Arb Detection
- [ ] Add rebounds, assists, 3PM O/U from FanDuel (currently only points)
  - FanDuel event page has player rebounds/assists as separate market types
  - Need to map `TO_RECORD_X+_REBOUNDS` (binary) vs actual O/U markets
- [ ] Add BetMGM player props (541 markets per fixture available)
  - Template categories: Points (78 markets), Player specials (79 markets)
  - Extract O/U player points, rebounds, assists from fixture-view
- [ ] Ensure player name normalization matches across all books
  - "LeBron James" (Kambi) vs "L. James" (BetMGM) vs "LeBron James" (FanDuel)
  - Improve `normalizePlayerName()` in `prop-normalizer.ts`

#### b) Cross-Book Prop Matching
- [ ] Match props by: (event_id, prop_category, player_name, line_value)
- [ ] Handle line differences: Book A has 25.5, Book B has 26.5 — not comparable
- [ ] Only compare props with the SAME line_value across books
- [ ] Flag "near arbs" where combined prob is 100-101% (close to arb, might move)

#### c) Arb Calculator
- [ ] For each detected arb, show optimal stake allocation
- [ ] `Stake_A = (1 / odds_A) / (1/odds_A + 1/odds_B) × total_stake`
- [ ] Display: "Bet $54.20 on Over at BetRivers, $45.80 on Under at FanDuel → guaranteed $1.20 profit on $100"

#### d) Real-Time Arb Monitoring
- [ ] The 2-minute sync already runs automatically
- [ ] Add timestamp to arb page showing "Last scanned: X seconds ago"
- [ ] Highlight NEW arbs (appeared in last scan) vs persistent arbs

### Files to Modify
- `app/(app)/arbitrage/page.tsx` — arb calculator, timestamps, near-arb display
- `lib/pipelines/adapters/fanduel-props.ts` — add rebounds/assists props
- `lib/pipelines/adapters/betmgm-props.ts` — add player prop extraction
- `lib/pipelines/prop-normalizer.ts` — improve player name matching
- `app/api/cron/sync-props/route.ts` — wire new BetMGM/FanDuel props

---

## 3. Expand Props from Existing Books

### Goal
Extract every available player prop from books we already scrape — maximizing cross-book comparison without adding new adapters.

### Current Prop Coverage
| Book | Points | Rebounds | Assists | 3PM | PRA | Other |
|------|--------|----------|---------|-----|-----|-------|
| BetRivers (Kambi) | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | — |
| Unibet (Kambi) | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | — |
| LeoVegas (Kambi) | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | — |
| NorthStar (Kambi) | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | ✅ O/U | — |
| FanDuel | ✅ O/U | ❌ | ❌ | ❌ | ❌ | — |
| DraftKings | ❌ (milestones only) | ❌ | ❌ | ❌ | ❌ | — |
| BetMGM | ❌ (available, not extracted) | ❌ | ❌ | ❌ | ❌ | 541 mkts available |
| Pinnacle | ❌ (blocked from Vercel) | ❌ | ❌ | ❌ | ❌ | — |
| Others | ❌ | ❌ | ❌ | ❌ | ❌ | — |

### Target Prop Coverage
| Book | Points | Rebounds | Assists | 3PM | PRA |
|------|--------|----------|---------|-----|-----|
| 4× Kambi | ✅ | ✅ | ✅ | ✅ | ✅ |
| FanDuel | ✅ | ✅ | ✅ | ✅ | — |
| BetMGM | ✅ | ✅ | ✅ | ✅ | — |
| bwin | ✅ | ✅ | ✅ | ✅ | — |
| partypoker | ✅ | ✅ | ✅ | ✅ | — |

### What Needs to Be Done

#### a) FanDuel — Add Rebounds, Assists, 3PM
- [ ] The event-page endpoint already returns these market types
- [ ] Current code only extracts `PLAYER_X_TOTAL_POINTS`
- [ ] Need to also match: player rebounds, assists, 3-pointers
- [ ] FanDuel market types to map:
  - Rebounds: Look for `PLAYER_X_TOTAL_REBOUNDS` or similar
  - Assists: Look for `PLAYER_X_TOTAL_ASSISTS` or similar
  - May need to discover these from DevTools (check event page)

#### b) BetMGM/bwin/partypoker — Extract Player Props
- [ ] The `fixture-view` endpoint returns 541 markets including:
  - `Points` (78 markets) — player points O/U
  - `Player specials` (79 markets) — rebounds, assists, 3PM, combos
- [ ] Parse `templateCategory.name` to identify prop type:
  - "Points" → player_points
  - "Rebounds" → player_rebounds  
  - "Assists" → player_assists
  - "Three Pointers" → player_threes
- [ ] Extract player name from market `name` field (e.g., "Tyler Herro - Points")
- [ ] Extract O/U line from `attr` field and odds from `options[].price.americanOdds`
- [ ] Write to `prop_odds` table

#### c) Player Name Normalization Improvements
- [ ] BetMGM uses full names with team abbreviation: "Tyler Herro (MIA)"
- [ ] Strip team abbreviation before normalizing
- [ ] Build a manual alias table for known mismatches:
  ```
  "Nic Claxton" ↔ "Nicolas Claxton"
  "P.J. Washington" ↔ "PJ Washington"
  ```
- [ ] Log unmatched player names for manual review

### Files to Modify
- `lib/pipelines/adapters/fanduel-props.ts` — expand `fetchEventProps()` for more stat types
- `lib/pipelines/adapters/betmgm-props.ts` — add `parsePlayerProps()` function
- `lib/pipelines/adapters/bwin-props.ts` — same (Entain clone)
- `lib/pipelines/adapters/partypoker-props.ts` — same (Entain clone)
- `lib/pipelines/prop-normalizer.ts` — add BetMGM category mapping, improve name normalization
- `app/api/cron/sync-props/route.ts` — wire new prop extraction into sync loop

---

## 4. Alerts & Notifications

### Goal
Get notified instantly when an arb or +EV opportunity appears — push to email, Discord, or in-app.

### Architecture Options

#### Option A: In-App Polling (Simplest)
- [ ] Add "last scanned" timestamp to Arb and EV pages
- [ ] Add auto-refresh toggle (poll every 30s)
- [ ] Show notification badge in sidebar when new opportunities found
- [ ] Store "seen" arbs in localStorage to highlight new ones

#### Option B: Discord Webhook (Best for real-time)
- [ ] Add `DISCORD_WEBHOOK_URL` env variable
- [ ] At end of `sync-props` cron, after arb/EV detection:
  - If new arb with profit > 1%: send Discord message
  - If new +EV line with EV > 3%: send Discord message
- [ ] Format: embed with event, odds, book names, profit %, stake suggestion
- [ ] Throttle: max 1 message per opportunity (dedup by hash)

#### Option C: Email Alerts (Pro feature)
- [ ] Use Resend or SendGrid for transactional email
- [ ] User configures alert preferences in Account settings:
  - Minimum EV% threshold
  - Minimum arb profit% threshold
  - Which sports/leagues
  - Alert frequency (immediate, every 15 min digest, daily)
- [ ] Store alert preferences in `profiles` table
- [ ] Background job checks new opportunities against user preferences

### Recommended Implementation Order
1. **Discord webhook** — 30 minutes to implement, instant value
2. **In-app badges** — sidebar badge when arbs/EV detected
3. **Email alerts** — Pro-tier feature

### What Needs to Be Done

#### a) Discord Webhook (Phase 1)
- [ ] Create Discord server + webhook URL
- [ ] Add `DISCORD_WEBHOOK_URL` to Vercel env vars
- [ ] Add arb/EV detection logic to end of `sync-props` route
- [ ] Send formatted embed when profitable opportunity found
- [ ] Dedup: track sent alerts in memory or `pipeline_runs` to avoid spam

#### b) In-App Alert Badge (Phase 2)
- [ ] Add `alerts` or `opportunities` table:
  ```sql
  CREATE TABLE opportunities (
    id UUID PRIMARY KEY,
    type TEXT NOT NULL, -- 'arb' | 'ev'
    event_id UUID REFERENCES events(id),
    description TEXT,
    profit_pct NUMERIC,
    ev_pct NUMERIC,
    detected_at TIMESTAMPTZ,
    expired_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
  );
  ```
- [ ] Sync-props writes new opportunities to this table
- [ ] Sidebar queries active opportunity count
- [ ] Badge shows on Arbitrage and Top EV Lines nav items

#### c) Email Alerts (Phase 3)
- [ ] Add alert preferences to `profiles` table
- [ ] Build alert settings UI in Account page
- [ ] Create email templates (arb alert, EV alert, daily digest)
- [ ] Background function checks and sends emails

### Files to Create/Modify
- `lib/alerts/discord.ts` — Discord webhook sender
- `app/api/cron/sync-props/route.ts` — add opportunity detection + alerts at end
- `components/layout/sidebar.tsx` — alert badge
- `supabase/migrations/014_opportunities.sql` — opportunities table

---

## 5. Event Deduplication Cleanup

### Goal
Ensure each real-world game has exactly ONE row in the `events` table, with ALL books' odds pointing to that single event. Eliminate duplicate events from different sources using different team names or slightly different start times.

### Current Problems
- "Miami Heat vs Charlotte Hornets" (Kambi) and "Charlotte Hornets vs Miami Heat" (FanDuel) → 2 events
- Start times differ by minutes (22:00 vs 22:10) → not matching
- Team name variations: "LA Clippers" vs "Los Angeles Clippers"
- Some books use abbreviations: "PHI 76ers" vs "Philadelphia 76ers"

### Current Matching Logic
- `findEvent()` in sync-props uses sorted team pairs (order-independent)
- `makeNicknameKey()` matches by last word of team name (e.g., "Hornets")
- `normalizeTeamForMatch()` strips parentheticals, expands abbreviations
- `canonicalEventKey()` in normalize.ts for pipeline adapters

### What Needs to Be Done

#### a) Comprehensive Team Name Dictionary
- [ ] Build a master team alias table:
  ```typescript
  const TEAM_ALIASES: Record<string, string> = {
    'philly': 'philadelphia 76ers',
    'phi 76ers': 'philadelphia 76ers',
    'sixers': 'philadelphia 76ers',
    'la lakers': 'los angeles lakers',
    'lal': 'los angeles lakers',
    // ... all NBA, MLB, NHL, Soccer teams
  }
  ```
- [ ] Apply during both event creation and event matching
- [ ] Include common abbreviations from all sources (Kambi, DK, FD, Betway, BetMGM)

#### b) Time-Window Matching
- [ ] Instead of matching on exact date, use a ±4 hour window
- [ ] Games near midnight (UTC) currently split across dates
- [ ] Match by: league + sorted team nicknames + date (±4hr)

#### c) Periodic Dedup Job
- [ ] SQL function that finds and merges duplicate events:
  ```sql
  -- Find duplicates: same league, same date, similar teams
  -- Merge: move all current_market_odds and prop_odds to the canonical event
  -- Delete: remove the duplicate event (CASCADE handles the rest)
  ```
- [ ] Run as part of sync-props cron (once per hour, not every 2 min)
- [ ] Log merged events for audit

#### d) Event Title Normalization
- [ ] Standardize all event titles to: "Away Team vs Home Team"
- [ ] Always use full team names (never abbreviations)
- [ ] Strip any extra info (pitcher names, round info)

### Files to Modify
- `app/api/cron/sync-props/route.ts` — improve `findEvent()`, add dedup job
- `lib/pipelines/normalize.ts` — improve `canonicalEventKey()` with aliases
- `lib/pipelines/prop-normalizer.ts` — add team alias dictionary
- `supabase/migrations/` — dedup SQL function

---

## Priority Order

| # | Feature | Impact | Effort | Recommendation |
|---|---------|--------|--------|----------------|
| 1 | +EV Detection | 🟢 High (money) | Medium | Do first — verify existing, add props |
| 2 | Prop Arbs | 🟢 High (money) | Medium | Do second — expand prop coverage |
| 3 | More Props | 🟡 Medium (enables 1+2) | Medium | Do alongside 1+2 |
| 4 | Alerts | 🟢 High (actionable) | Low-Medium | Discord webhook = 30 min |
| 5 | Event Dedup | 🟡 Medium (UX) | Medium | Do when data issues are visible |

### Suggested Sprint Plan

**Sprint 1 (2-3 sessions):** +EV Verification + Discord Alerts
- Verify Pinnacle data feeds into EV calculations
- Add prop +EV detection
- Set up Discord webhook for instant alerts

**Sprint 2 (2-3 sessions):** Prop Expansion
- Add BetMGM player props (Points, Rebounds, Assists)
- Add FanDuel Rebounds/Assists
- Improve player name normalization

**Sprint 3 (1-2 sessions):** Arb Enhancement + Dedup
- Arb calculator with stake suggestions
- Event dedup cleanup
- Team name alias dictionary
