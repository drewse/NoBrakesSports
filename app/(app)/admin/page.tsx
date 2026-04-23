import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Users, CreditCard, Activity, Flag, Database, ChevronRight, CheckCircle2, Clock, Wrench, AlertCircle, Gauge } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Admin' }

const ADMIN_SECTIONS = [
  { href: '/admin/users', icon: Users, label: 'User Management', desc: 'View and manage all user accounts' },
  { href: '/admin/subscriptions', icon: CreditCard, label: 'Subscriptions', desc: 'View subscription status and billing' },
  { href: '/admin/data-health', icon: Activity, label: 'Data Source Health', desc: 'Monitor market source status' },
  { href: '/admin/proxy-usage', icon: Gauge, label: 'Proxy Bandwidth', desc: 'Track mobile / residential proxy spend' },
  { href: '/admin/feature-flags', icon: Flag, label: 'Feature Flags', desc: 'Toggle features for users or tiers' },
]

type ImplStatus = 'live' | 'partial' | 'in_progress' | 'planned' | 'blocked' | 'dead' | 'covered'

type DeployTarget = 'railway' | 'vercel' | 'unknown'

interface CaBookEntry {
  name: string
  slug: string
  platform: string
  difficulty: 'easy' | 'medium' | 'hard'
  status: ImplStatus
  deployedTo: DeployTarget
  gameLevel: boolean     // ML, spread, total
  props: boolean         // player props
  frequency: string | null // e.g. "2 min"
  notes: string
}

// Canadian book tracker — reflects current Railway worker + Vercel cron state.
// Updated with live observations from Railway logs (April 2026 iteration).
const CA_BOOK_TRACKER: CaBookEntry[] = [
  // ── Live producers (game markets AND/OR props flowing) ────────────────
  { name: 'BetRivers ON',  slug: 'betrivers',    platform: 'Kambi',         difficulty: 'easy',   status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Primary Kambi operator (rsicaon). Handled by Vercel pipeline.' },
  { name: 'Unibet CA',     slug: 'unibet',       platform: 'Kambi',         difficulty: 'easy',   status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Kambi operator (ubca)' },
  { name: 'LeoVegas',      slug: 'leovegas',     platform: 'Kambi',         difficulty: 'easy',   status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Kambi operator (leose)' },
  { name: 'NorthStar Bets', slug: 'northstarbets', platform: 'Kambi',       difficulty: 'easy',   status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Kambi operator (torstarcaon)' },
  { name: 'FanDuel',       slug: 'fanduel',      platform: 'FD API',        difficulty: 'medium', status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Public API with _ak key. NBA/MLB/NHL.' },
  { name: 'Betway',        slug: 'betway',       platform: 'Betway API',    difficulty: 'medium', status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: true,  frequency: '2 min',  notes: 'Just fixed RBI mislabel on Total Bases (Hits Only) variants' },
  { name: 'BetMGM ON',     slug: 'betmgm_on',    platform: 'Entain CDS',    difficulty: 'medium', status: 'partial',     deployedTo: 'railway', gameLevel: false, props: false, frequency: '3 min',  notes: '26 fixtures flowing (19 NBA + 14 MLB + 19 NHL, deduped). Market extractor broken — totalGameMkts=0 every cycle despite successful fixture list. Needs market-payload investigation (separate from CA fixes).' },
  { name: 'PointsBet ON',  slug: 'pointsbet_on', platform: 'PointsBet API', difficulty: 'medium', status: 'live',        deployedTo: 'railway', gameLevel: true,  props: true,  frequency: '3 min',  notes: '~230 events/tick. Most reliable Railway adapter.' },
  { name: 'Pinnacle',      slug: 'pinnacle',     platform: 'Pinnacle API',  difficulty: 'medium', status: 'live',        deployedTo: 'railway', gameLevel: true,  props: true,  frequency: '3 min',  notes: '~115 events/tick with props' },
  { name: 'bwin',          slug: 'bwin',         platform: 'Entain CDS',    difficulty: 'easy',   status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: false, frequency: '2 min',  notes: 'Same Entain CDS as BetMGM' },
  { name: 'partypoker',    slug: 'partypoker',   platform: 'Entain CDS',    difficulty: 'easy',   status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: false, frequency: '2 min',  notes: 'Same Entain CDS as BetMGM' },
  { name: 'DraftKings',    slug: 'draftkings',   platform: 'DK API',        difficulty: 'medium', status: 'live',        deployedTo: 'vercel',  gameLevel: true,  props: false, frequency: '2 min',  notes: 'Public API. CA-ON-SB site.' },

  // ── Partial (events flow, markets missing) ────────────────────────────
  { name: '888sport',      slug: '888sport',     platform: 'Spectate',      difficulty: 'medium', status: 'live',        deployedTo: 'railway', gameLevel: true,  props: false, frequency: '5 min',  notes: '16 events + 48 game markets/tick via getTournamentMatches. Stable. Remaining: props (not in game-lines endpoint — needs per-event call).' },
  { name: 'TonyBet',       slug: 'tonybet',      platform: 'BetConstruct',  difficulty: 'hard',   status: 'partial',     deployedTo: 'railway', gameLevel: false, props: false, frequency: '15 min', notes: '17 events flowing via slug-based team extraction. Markets still 0 — /api/event/list?relations=odds returns config paths but no odds payload on passive capture. Needs active fetch with session cookies.' },

  // ── Partial (Kambi adapters wired, awaiting live games) ───────────────
  { name: 'Proline (OLG)', slug: 'proline',      platform: 'Kambi',         difficulty: 'easy',   status: 'live',        deployedTo: 'railway', gameLevel: true,  props: false, frequency: '3 min',  notes: '9 events + 27 game markets/tick via Kambi listView matches.json (olgsportscaon). NBA/MLB/NHL. Remaining: props (Kambi props live on separate betOffer criterion — needs second pass).' },
  { name: 'Bally Bet',     slug: 'ballybet',     platform: 'Kambi',         difficulty: 'easy',   status: 'live',        deployedTo: 'railway', gameLevel: true,  props: false, frequency: '3 min',  notes: '9 events + 27 game markets/tick via Kambi listView (bcscaon, eu1 host). NBA/MLB/NHL. Remaining: props (same story as Proline).' },

  // ── Infra-blocked (needs CA residential proxy or CA VPS) ──────────────
  { name: 'Caesars',       slug: 'caesars',      platform: 'Liberty',       difficulty: 'hard',   status: 'live',        deployedTo: 'railway', gameLevel: true,  props: false, frequency: '15 min', notes: '21 events + 63 game markets/tick (NBA 8 + MLB 13). Mobile proxy (IPRoyal) clears AWS WAF; /tabs body parser extracts events with ML/spread/total inline. NHL=0 legitimate (no games). Remaining: props (Caesars prop markets live on per-event dataPaths — separate fetch per event via /v4/sport/.../market-display-groups/...), game-lines for NHL when games exist.' },
  { name: 'BetVictor',     slug: 'betvictor',    platform: 'Proprietary',   difficulty: 'hard',   status: 'partial',     deployedTo: 'railway', gameLevel: false, props: false, frequency: '15 min', notes: 'HTML scrape captures 8-22 event cards/league (via mobile proxy) but /bv_api/en-on/overview/markets returns [] with CSRF token attached. Remaining: figure out why markets API empty — may need per-event endpoint call or different query param.' },
  { name: 'bet365',        slug: 'bet365',       platform: 'Proprietary',   difficulty: 'hard',   status: 'blocked',     deployedTo: 'railway', gameLevel: false, props: false, frequency: null,     notes: 'Data served exclusively over WebSocket, not HTTP. Mobile proxy clears CF but odds stream over WSS bc.static.on.bet365.ca. Parked — would require Playwright WS interception or dedicated WS client (separate project).' },
  { name: 'BET99',         slug: 'bet99',        platform: 'SBTech/Entain', difficulty: 'hard',   status: 'in_progress', deployedTo: 'railway', gameLevel: false, props: false, frequency: '15 min', notes: 'Mobile proxy clears bot gate. Discovery mode (captures XHRs) running; need to identify event-feed endpoint from captured path list before writing a parser.' },
  { name: 'theScore Bet',  slug: 'thescore',     platform: 'Penn (Apollo)', difficulty: 'hard',   status: 'partial',     deployedTo: 'railway', gameLevel: false, props: false, frequency: '15 min', notes: 'Mobile proxy + anonAuth JWT replay works. CompetitionPage operation fires 3x per cycle (NBA/MLB/NHL section nav captured). "Lines" section body (400KB) contains only Featured Parlays + Recommended Props — no actual game lines on the competition page. Remaining: navigate individual event pages via deepLink.webUrl to fetch per-event markets (each game = separate fetch).' },

  // ── Hard to implement (no clean API — needs HTML scrape) ──────────────
  { name: 'Betano',        slug: 'betano',       platform: 'Kaizen (SSR)',  difficulty: 'hard',   status: 'in_progress', deployedTo: 'railway', gameLevel: false, props: false, frequency: '15 min', notes: 'Discovery confirms events are SSR-rendered into HTML (no events-list XHR). Captured /api/static-content/assets and /api/kb-config paths but no odds feed. Remaining: HTML parser for event cards + per-event betbuilder calls, OR find a hidden JSON endpoint.' },
  { name: 'Casumo',        slug: 'casumo',       platform: 'N/A',           difficulty: 'easy',   status: 'dead',        deployedTo: 'unknown', gameLevel: false, props: false, frequency: null,     notes: 'Casumo CA has no sportsbook product — confirmed. Removed from worker.' },

  // ── Planned CA-only (narrow footprint) ────────────────────────────────
  { name: 'Miseojeu',      slug: 'miseojeu',     platform: 'Loto-Québec',   difficulty: 'hard',   status: 'planned',     deployedTo: 'unknown', gameLevel: false, props: false, frequency: null,     notes: 'Loto-Québec\'s sports product (QC only). Government-operator, likely no clean API — HTML scrape territory. Low priority.' },
  { name: 'PowerPlay',     slug: 'powerplay',    platform: 'SBTech / Playtech', difficulty: 'medium', status: 'planned', deployedTo: 'unknown', gameLevel: false, props: false, frequency: null,     notes: 'Ontario-licensed book. Adds another sharp source for AGCO market. Probe needed.' },

  // ── Dead / Removed ────────────────────────────────────────────────────
  { name: 'Sports Interaction', slug: 'sports_interaction', platform: 'Entain CDS', difficulty: 'medium', status: 'planned', deployedTo: 'unknown', gameLevel: false, props: false, frequency: null, notes: 'Entain GraphQL API. Needs DevTools investigation' },
  { name: 'Jackpot.bet',   slug: 'jackpotbet',   platform: 'Proprietary',   difficulty: 'hard',   status: 'dead',        deployedTo: 'unknown', gameLevel: false, props: false, frequency: null,     notes: 'Domain parked/dead (confirmed via discovery log)' },
]

// ── USA Legal Book Tracker — all planned, prioritized by category ─────
type UsaCategory = 'major' | 'regional' | 'exchange' | 'dfs-sweepstakes' | 'offshore'

interface UsaBookEntry {
  name: string
  slug: string
  operator: string
  url: string
  platform: string
  category: UsaCategory
  states: string[]
  status: ImplStatus
  notes: string
}

// ── Roadmap tiers for books still to ship ─────────────────────────────
// Mapping slug → tier, so the tracker stays a single source of truth and
// tiers can be moved around without touching every row.
//   T1 — ship next. Highest user-visible lift. Mostly major regulated US
//        books and the two blocked offshores where the adapter already
//        exists (LowVig, BetParx) and just awaits a working US-mobile
//        proxy or a Railway browser-session unlock.
//   T2 — prediction / exchange markets. Order-book pricing model differs
//        from sportsbooks; shared "exchange adapter" layer makes the
//        three plausible together rather than one-by-one.
//   T3 — offshore sportsbooks (BetUS, BetAnySports, MyBookie, Bookmaker).
//        Accept nationwide, reduced-juice candidates. Cloudflare-gated;
//        need the same US-mobile proxy infra as Tier 1 majors.
//   T4 — US regionals with narrow (single-state or two-state) footprint.
//        Lowest coverage ROI per adapter; ship when bigger tiers exhaust.
//   T5 — CA-only additions (Miseojeu, PowerPlay).
type Tier = 1 | 2 | 3 | 4 | 5
const TIER_BY_SLUG: Record<string, Tier> = {
  // Tier 1 — biggest US coverage lift
  'hard-rock-bet':       1,
  'lowvig':              1,  // adapter shipped, awaiting Railway US-mobile
  'betparx':             1,  // needs browser-session scrape on Railway
  'fliff':               1,
  'betus':               1,
  // Tier 2 — exchanges / prediction markets
  'sporttrade':          2,
  'novig':               2,
  'prophet-exchange':    2,
  // Tier 3 — additional offshore reduced-juice
  'betanysports':        3,
  'mybookie':            3,
  'bookmaker-eu':        3,
  'sportsbetting-ag':    3,
  // Tier 4 — US regionals (narrow footprint)
  'betfred-us':          4,
  'circa-sports':        4,
  'betly':               4,
  'wynnbet':             4,
  'firekeepers':         4,
  'four-winds':          4,
  'eagle-casino-sports': 4,
  'island-resort':       4,
  'ocean-casino':        4,
  'resorts-world-bet':   4,
  'tipico-us':           4,
  'desert-diamond':      4,
  'betsson-us':          4,
  // Tier 5 — CA-only additions (tracked on CA side but listed for completeness)
  'miseojeu':            5,
  'powerplay':           5,
}

const USA_BOOK_TRACKER: UsaBookEntry[] = [
  // ── Majors (DFS + broad multi-state footprint) ────────────────────────
  { name: 'DraftKings',          slug: 'draftkings-us',      operator: 'DraftKings Inc.',                 url: 'https://sportsbook.draftkings.com',  platform: 'SBTech (proprietary)',       category: 'major',    states: ['AZ','CO','CT','DC','IL','IN','IA','KS','KY','LA','MA','MD','ME','MI','NC','NH','NJ','NY','OH','OR','PA','TN','VA','VT','WV','WY'], status: 'covered', notes: 'Same DK API as CA DraftKings adapter. Lines effectively identical across states — reuse CA feed.' },
  { name: 'FanDuel',             slug: 'fanduel-us',         operator: 'Flutter Entertainment',           url: 'https://sportsbook.fanduel.com',     platform: 'Flutter (IGT/proprietary)',  category: 'major',    states: ['AZ','CO','CT','DC','IL','IN','IA','KS','KY','LA','MA','MD','ME','MI','NC','NH','NJ','NY','OH','PA','TN','VA','VT','WV','WY'], status: 'covered', notes: 'Same Flutter/FD API as CA FanDuel adapter. Reuse CA feed.' },
  { name: 'BetMGM',              slug: 'betmgm-us',          operator: 'MGM Resorts / Entain',            url: 'https://sports.betmgm.com',          platform: 'Entain CDS',                 category: 'major',    states: ['AZ','CO','DC','IL','IN','IA','KS','KY','LA','MA','MD','ME','MI','MS','NJ','NV','NY','NC','OH','PA','TN','VA','WV','WY'], status: 'covered', notes: 'Same Entain CDS as BetMGM ON. Reuse CA feed.' },
  { name: 'Caesars',             slug: 'caesars-us',         operator: 'Caesars Entertainment',           url: 'https://sportsbook.caesars.com',     platform: 'Liberty (proprietary)',      category: 'major',    states: ['AZ','CO','DC','IL','IN','IA','KS','KY','LA','MA','MD','ME','MI','NJ','NV','NY','NC','OH','PA','TN','VA','WV','WY'], status: 'covered', notes: 'Same Liberty platform as CA Caesars. CA adapter already hits /regions/us/locations/co/ endpoints via mobile proxy. Reuse CA feed.' },
  { name: 'ESPN Bet',            slug: 'espn-bet',           operator: 'PENN Entertainment',              url: 'https://espnbet.com',                platform: 'PENN (ex-theScore)',         category: 'major',    states: ['AZ','CO','IL','IN','IA','KS','KY','LA','MD','MA','ME','MI','NC','NJ','NY','OH','PA','TN','VA','VT','WV'], status: 'covered', notes: 'PENN rebrand of the theScore Bet stack — same Apollo GraphQL surface as CA theScore. Reuse CA pipeline (same blockers/unblockers apply).' },
  { name: 'Fanatics',            slug: 'fanatics',           operator: 'Fanatics Betting and Gaming',     url: 'https://sportsbook.fanatics.com',    platform: 'Proprietary (ex-PointsBet)', category: 'major',    states: ['AZ','CO','CT','IL','IN','IA','KY','LA','MD','MA','MI','NC','NJ','NY','OH','PA','TN','VA','VT','WV'], status: 'covered', notes: 'Runs on the PointsBet US tech stack Fanatics absorbed — same API surface as our PointsBet ON adapter. Reuse CA feed.' },
  { name: 'BetRivers',           slug: 'betrivers-us',       operator: 'Rush Street Interactive',         url: 'https://betrivers.com',              platform: 'Kambi + RSI',                category: 'major',    states: ['AZ','CO','DE','IL','IN','IA','LA','MD','MI','NJ','NY','OH','PA','VA','WV'], status: 'covered', notes: 'Same Kambi stack as CA BetRivers adapter. Reuse CA feed.' },
  { name: 'Hard Rock Bet',       slug: 'hard-rock-bet',      operator: 'Hard Rock Digital',               url: 'https://app.hardrock.bet',           platform: 'Hard Rock Digital',          category: 'major',    states: ['AZ','FL','IN','NJ','OH','TN','VA'], status: 'planned', notes: 'Dominant in FL.' },
  { name: 'bet365 US',           slug: 'bet365-us',          operator: 'bet365 Group',                    url: 'https://www.bet365.com',             platform: 'Proprietary',                category: 'major',    states: ['AZ','CO','IA','IN','KY','LA','NC','NJ','OH','TN','VA'], status: 'covered', notes: 'Same WSS-only transport as CA bet365 — same infra blocker. No separate US work.' },

  // ── Regionals (single-state or narrow footprint) ──────────────────────
  { name: 'Bally Bet',           slug: 'bally-bet-us',       operator: "Bally's Corporation",             url: 'https://play.ballybet.com',          platform: 'Kambi + White Hat',          category: 'regional', states: ['AZ','CO','IN','NJ','NY','OH','VA'], status: 'covered', notes: 'Same Kambi stack as CA Bally Bet adapter. Reuse CA feed.' },
  { name: 'Betfred Sports',      slug: 'betfred-us',         operator: 'Betfred Group',                   url: 'https://www.betfred.com',            platform: 'Proprietary',                category: 'regional', states: ['AZ','CO','IA','NV','OH','PA','VA'], status: 'planned', notes: 'UK operator w/ US footprint.' },
  { name: 'Betly',               slug: 'betly',              operator: 'Delaware North',                  url: 'https://betly.com',                  platform: 'White Hat / Kambi',          category: 'regional', states: ['AR','OH','TN','WV'], status: 'planned', notes: 'Regional brand.' },
  { name: 'SI Sportsbook',       slug: 'si-sportsbook',      operator: '888 Holdings',                    url: 'https://www.sisportsbook.com',       platform: '888/SBTech',                 category: 'regional', states: ['CO','MI','VA'], status: 'covered', notes: 'SI by 888 runs the Spectate stack — same surface as our 888sport CA adapter. Reuse CA feed.' },
  { name: 'WynnBET',             slug: 'wynnbet',            operator: 'Wynn Interactive',                url: 'https://www.wynnbet.com',            platform: 'Proprietary',                category: 'regional', states: ['MI','NV','NY'], status: 'planned', notes: 'Shrinking footprint.' },
  { name: 'Tipico US',           slug: 'tipico-us',          operator: 'Tipico Group',                    url: 'https://tipico.us',                  platform: 'Proprietary',                category: 'regional', states: ['NJ'], status: 'planned', notes: 'Most US states wound down.' },
  { name: 'Circa Sports',        slug: 'circa-sports',       operator: 'Circa Resort & Casino',           url: 'https://www.circasports.com',        platform: 'CG Technology',              category: 'regional', states: ['CO','IA','IL','KY','NV'], status: 'planned', notes: 'Vegas-first, small online footprint.' },
  { name: 'Desert Diamond',      slug: 'desert-diamond',     operator: 'Tohono O\'odham Gaming',          url: 'https://az.desertdiamondsports.com', platform: 'Light & Wonder OpenSports',  category: 'regional', states: ['AZ'], status: 'planned', notes: 'SBTech/Light & Wonder stack.' },
  { name: 'Golden Nugget',       slug: 'golden-nugget',      operator: 'DraftKings Inc.',                 url: 'https://www.goldennuggetcasino.com/sports', platform: 'DraftKings (SBTech)',  category: 'regional', states: ['MI','NJ','WV'], status: 'covered', notes: 'DraftKings-owned; runs on the DK (SBTech) stack. Reuse CA DraftKings feed.' },
  { name: 'FireKeepers',         slug: 'firekeepers',        operator: 'FireKeepers Casino',              url: 'https://firekeeperssportsbook.com',  platform: 'Light & Wonder',             category: 'regional', states: ['MI'], status: 'planned', notes: 'Tribal MI operator.' },
  { name: 'Four Winds',          slug: 'four-winds',         operator: 'Pokagon Band',                    url: 'https://www.fourwindscasino.com/sportsbook', platform: 'Kambi',              category: 'regional', states: ['MI'], status: 'planned', notes: 'Tribal MI on Kambi.' },
  { name: 'Eagle Sports',        slug: 'eagle-casino-sports', operator: 'Soaring Eagle Casino',           url: 'https://www.playeaglemi.com',        platform: 'Parlay Group (IGT)',         category: 'regional', states: ['MI'], status: 'planned', notes: 'Tribal MI.' },
  { name: 'Island Resort',       slug: 'island-resort',      operator: 'Hannahville',                     url: 'https://islandresortsportsbook.com', platform: 'GAN / Kambi',                category: 'regional', states: ['MI'], status: 'planned', notes: 'Small tribal book.' },
  { name: 'Ocean Casino',        slug: 'ocean-casino',       operator: 'Ocean Casino Resort',             url: 'https://www.theoceancasino.com/sports', platform: 'GAN / Kambi',             category: 'regional', states: ['NJ'], status: 'planned', notes: 'AC-based.' },
  { name: 'Resorts World Bet',   slug: 'resorts-world-bet',  operator: 'Genting Group',                   url: 'https://www.rwbet.com',              platform: 'Kambi',                      category: 'regional', states: ['NY'], status: 'planned', notes: 'NY-only.' },
  { name: 'Rivers Casino SB',    slug: 'rivers-casino',      operator: 'Rush Street Gaming',              url: 'https://www.playsugarhouse.com',     platform: 'Kambi + RSI',                category: 'regional', states: ['NJ','PA'], status: 'covered', notes: 'RSI sister-brand to BetRivers, same Kambi stack. Reuse CA BetRivers feed.' },

  // ── Exchanges / prediction markets ────────────────────────────────────
  { name: 'Sporttrade',          slug: 'sporttrade',         operator: 'Sporttrade Inc.',                 url: 'https://sporttrade.com',             platform: 'Proprietary exchange',       category: 'exchange', states: ['CO','IA','NJ'], status: 'planned', notes: 'Order-book exchange, different pricing model (needs adapter layer).' },
  { name: 'Novig',               slug: 'novig',              operator: 'Novig Inc.',                      url: 'https://novig.us',                   platform: 'Proprietary exchange',       category: 'exchange', states: ['CO'], status: 'planned', notes: 'Newer exchange.' },
  { name: 'Prophet Exchange',    slug: 'prophet-exchange',   operator: 'Prophet Sports Exchange',         url: 'https://prophetexchange.com',        platform: 'Proprietary exchange',       category: 'exchange', states: ['IN','NJ','OH'], status: 'planned', notes: 'Peer-to-peer.' },
  { name: 'Kalshi',              slug: 'kalshi',             operator: 'KalshiEX (CFTC DCM)',             url: 'https://kalshi.com',                 platform: 'Event contract exchange',    category: 'exchange', states: ['ALL'], status: 'live', notes: 'Hourly cron. 751 pred-market contracts → prediction_market_snapshots + game-winner pairs (KXNBAGAME/KXMLBGAME/KXNHLGAME) converted to moneyline rows in market_snapshots so they flow to Markets/EV/Arb. 31/82 pairs matched first verify fire (unmatched are future playoff games not yet in events table). Per-sport city→full-name maps + NHL ABBR-nickname fallback handle all 3 leagues.' },
  { name: 'Polymarket',          slug: 'polymarket',         operator: 'Polymarket (QCX)',                url: 'https://polymarket.com',             platform: 'Prediction market',          category: 'exchange', states: ['ALL'], status: 'live', notes: 'Hourly cron. 17.9k pred-market snapshots/fire + 268 moneyline events matched to canonical sportsbook games. Team-outcome parser handles per-game ["Rays","Red Sox"] outcomes alongside original ["Yes","No"] shape. Per-game NBA/MLB/NHL coverage on Polymarket is genuinely sparse (most sports content is season futures + soccer); 268 approximates the real overlap with our events table.' },
  { name: 'Robinhood Predict',   slug: 'robinhood-prediction', operator: 'Robinhood Derivatives',         url: 'https://robinhood.com/prediction-markets', platform: 'Kalshi-powered',       category: 'exchange', states: ['ALL'], status: 'covered', notes: 'White-labeled Kalshi — contracts are re-priced Kalshi markets. No separate ingestion needed; reuse Kalshi data.' },

  // ── DFS / Sweepstakes pick-ems (treat with care; legal status varies) ─
  { name: 'Fliff',               slug: 'fliff',              operator: 'Fliff Inc.',                      url: 'https://www.getfliff.com',           platform: 'Sweepstakes',                category: 'dfs-sweepstakes', states: ['MOST_EX:WA,NY,ID,MI,LA,NV,TN,CT,MS,IN,OH'], status: 'planned', notes: 'Social-sweeps model; lines are real-ish but not cash wagers.' },
  { name: 'PrizePicks',          slug: 'prizepicks',         operator: 'PrizePicks LLC',                  url: 'https://www.prizepicks.com',         platform: 'DFS pick-em',                category: 'dfs-sweepstakes', states: ['AK','CA','DC','FL','GA','IA','IL','IN','KS','KY','MN','NC','ND','NE','NM','OK','OR','RI','SC','SD','TX','UT','VA','WI'], status: 'live', notes: 'Vercel cron every 2 min. First production cycle: NBA 8 games/685 props, MLB 9 games/105 props, NHL/NFL 0 (NHL transient fetch_failed; NFL off-season). games matched=17 unmatched=0 — 100% event-match rate against canonical events. Model A: line_value populated, over/under NULL.' },
  { name: 'Underdog Fantasy',    slug: 'underdog',           operator: 'Underdog Sports',                 url: 'https://underdogfantasy.com',        platform: 'DFS pick-em',                category: 'dfs-sweepstakes', states: ['AK','CA','DC','FL','GA','IL','IN','KS','KY','MN','NC','ND','NE','NM','OK','OR','RI','SC','SD','TX','UT','WI'], status: 'in_progress', notes: 'Model B adapter: real American odds per higher/lower option. Initially wired into sync-props but its 16MB payload + PrizePicks+all-books caused OOM/timeout (sync-props stopped firing after first Underdog deploy). Moved to standalone /api/cron/sync-underdog route, 5-min schedule, 120s maxDuration — isolated function memory budget. Awaiting first standalone-cron fire.' },
  { name: 'Sleeper Picks',       slug: 'sleeper',            operator: 'Sleeper Fantasy',                 url: 'https://sleeper.com/picks',          platform: 'DFS pick-em',                category: 'dfs-sweepstakes', states: ['AK','CA','FL','GA','IL','KS','KY','MN','NC','ND','NE','NM','OK','OR','RI','SC','TX','UT','WI'], status: 'live', notes: 'First verified fire: 18 games, 1796 props inserted, 100% match rate. Cron: /api/cron/sync-sleeper every 5 min (+2 min offset from Underdog). Model B — decimal payout_multiplier converted to American. Sleeper does not expose start_time or home/away flags, so cron matches by (league, sorted team-abbr pair) against upcoming events; abbr→full-name resolution uses hardcoded major-league maps (NBA/MLB/NHL/WNBA) since the DB teams table is sparsely seeded.' },

  // ── Additional regionals surfaced from The Odds API book list ─────────
  { name: 'BetParx',             slug: 'betparx',            operator: 'Parx Casino',                     url: 'https://betparx.com',                platform: 'Kambi',                      category: 'regional', states: ['IL','MD','NJ','OH','PA'],                  status: 'blocked', notes: 'Tested both direct-from-Vercel and via PacketStream-CA residential (pipeFetch). Both returned HTTP 429 on Kambi /parx/ endpoint; no 403 ever observed, so the block is endpoint-level rate limiting, not IP-geographic. USA PacketStream unlikely to help. Unlock requires a browser-session scrape (cookies from play.betparx.com) on the Railway worker.' },
  { name: 'Betsson US',          slug: 'betsson-us',         operator: 'Betsson Group',                   url: 'https://www.betsson.us',             platform: 'Betsson (Strive)',           category: 'regional', states: ['CO'],                                      status: 'planned', notes: 'CO-only via Strive/Dostal Alley partnership. Small footprint.' },

  // ── William Hill family → merged into Caesars ─────────────────────────
  { name: 'Caesars (William Hill US)', slug: 'williamhill-us', operator: 'Caesars Entertainment',         url: 'https://sportsbook.williamhill.com', platform: 'Liberty (proprietary)',      category: 'major',    states: ['AZ','CO','DC','IL','IN','IA','LA','MI','NJ','NV','NY','OH','PA','TN','VA','WV'], status: 'covered', notes: 'William Hill US rebranded under Caesars after the 2021 merger; runs on the same Liberty stack. Reuse CA Caesars feed.' },
  { name: 'William Hill',        slug: 'williamhill',        operator: 'Caesars Entertainment',           url: 'https://sportsbook.williamhill.com', platform: 'Liberty (proprietary)',      category: 'major',    states: ['NJ','NV'], status: 'covered', notes: 'Legacy William Hill brand — surviving in NJ/NV as a Caesars skin. Reuse CA Caesars feed.' },

  // ── Shut-down / defunct US operations ─────────────────────────────────
  { name: 'Unibet US',           slug: 'unibet-us',          operator: 'Kindred Group',                   url: 'https://unibet.com',                 platform: 'Kambi',                      category: 'regional', states: [],                                          status: 'dead',    notes: 'Kindred exited US market May 2024. US domain dormant. CA Unibet adapter still live for Canadian customers.' },

  // ── Offshore books (Curaçao / Panama-licensed, accept US customers) ──
  //     Greenlit for ingestion — serve nationwide without state licensing.
  //     Lines are often competitive; LowVig/BetAnySports specifically run
  //     reduced juice which makes them useful for EV/arb surfaces.
  { name: 'Bovada',              slug: 'bovada',             operator: 'Harp Media B.V.',                 url: 'https://www.bovada.lv',              platform: 'Proprietary',                category: 'offshore', states: ['ALL'], status: 'live', notes: 'First verify fire: 14 events (MLB 7 + NHL 7), 34 markets built, 30 upserted to current_market_odds, 100% match rate. Cron /api/cron/sync-bovada every 5 min. Public JSON /services/sports/event/coupon/events/A/description/{sport}/{league}. Does NOT auto-create events.' },
  { name: 'BetUS',               slug: 'betus',              operator: 'BetUS Gaming',                    url: 'https://www.betus.com.pa',           platform: 'Proprietary',                category: 'offshore', states: ['ALL'], status: 'planned', notes: 'Panama-licensed. Probed via PacketStream US: Cloudflare "Just a moment" challenge page. Needs Railway browser session (same stack as Hard Rock/Fanatics). Tier 1.' },
  { name: 'BetAnySports',        slug: 'betanysports',       operator: 'BetAnySports Curaçao',            url: 'https://www.betanysports.eu',        platform: 'ASI / DGS',                  category: 'offshore', states: ['ALL'], status: 'planned', notes: 'Reduced-juice book on the ASI (Digital Gaming) platform — same stack as several other Curaçao books. One adapter may cover multiple.' },
  { name: 'LowVig',              slug: 'lowvig',             operator: 'BetOnline group',                 url: 'https://www.lowvig.ag',              platform: 'Proprietary (BetOnline)',    category: 'offshore', states: ['ALL'], status: 'blocked', notes: 'Adapter shipped in BOTH Vercel (blocked 403) AND Railway (worker/adapters/betonline.ts) with us-mobile proxy tier. Cloudflare blocks datacenter + PacketStream CA + PacketStream US with HTTP 403; Railway Playwright with IPRoyal US-mobile is the unlock path. Gated behind BETONLINE_ENABLED=1 + MOBILE_PROXY_URL_US env vars.' },
  { name: 'Sportsbetting.ag',    slug: 'sportsbetting-ag',   operator: 'BetOnline group',                 url: 'https://www.sportsbetting.ag',       platform: 'Proprietary (BetOnline)',    category: 'offshore', states: ['ALL'], status: 'planned', notes: 'Third site on the same SAS platform as BetOnline + LowVig. Should be a one-line add to BETONLINE_OPERATORS once the Railway adapter fires — gsetting value to confirm from DevTools. Blocked behind the same Cloudflare wall.' },
  { name: 'MyBookie',            slug: 'mybookie',           operator: 'MyBookie.ag',                     url: 'https://www.mybookie.ag',            platform: 'Proprietary',                category: 'offshore', states: ['ALL'], status: 'planned', notes: 'Curaçao-licensed offshore. Own backend (not BetOnline/Kambi/etc.). Needs fresh DevTools probe to map odds API.' },
  { name: 'Bookmaker.eu',        slug: 'bookmaker-eu',       operator: 'Bookmaker.eu',                    url: 'https://www.bookmaker.eu',           platform: 'Proprietary',                category: 'offshore', states: ['ALL'], status: 'planned', notes: 'Long-standing offshore. Separate backend. Probe needed.' },
  { name: 'Stake',               slug: 'stake',              operator: 'Medium Rare N.V.',                url: 'https://stake.us',                   platform: 'Proprietary (crypto)',       category: 'offshore', states: ['ALL'], status: 'planned', notes: 'Crypto-first offshore with a sweepstakes-style US product (Stake.us). Popular in CA/LatAm. Own backend.' },
  { name: '1XBet',               slug: '1xbet',              operator: '1X Corp N.V.',                    url: 'https://1xbet.com',                  platform: 'Proprietary',                category: 'offshore', states: ['GRAY'], status: 'planned', notes: 'Gray-market globally, accepts US/CA. Legal status is murky — ship behind a feature flag if we add it.' },
  { name: 'BetCris',             slug: 'betcris',            operator: 'Grupo Caliente',                  url: 'https://betcris.com',                platform: 'Caliente tech',              category: 'offshore', states: ['GRAY'], status: 'planned', notes: 'LatAm-first offshore. Sister to Caliente.mx. Own backend.' },

  // ── Prediction markets / exchanges (order-book pricing) ──────────────
  { name: 'Fanatics Markets',    slug: 'fanatics-markets',   operator: 'Fanatics Betting and Gaming',     url: 'https://fanaticsmarkets.com',        platform: 'Event contract exchange',    category: 'exchange', states: ['ALL'], status: 'planned', notes: 'Fanatics\' prediction-market product (separate from Fanatics Sportsbook). CFTC-regulated. Worth probing for a REST odds feed.' },
  { name: 'DraftKings Predictions', slug: 'draftkings-predictions', operator: 'DraftKings Inc.',          url: 'https://sportsbook.draftkings.com/predictions', platform: 'DK backend',         category: 'exchange', states: ['ALL'], status: 'planned', notes: 'DK\'s new federally-licensed prediction market. Likely rides the same DK API surface — check if our DK adapter can add a market-type filter instead of a separate adapter.' },
  { name: 'Onyx Odds',           slug: 'onyx-odds',          operator: 'Onyx Markets',                    url: 'https://onyxodds.com',               platform: 'Proprietary exchange',       category: 'exchange', states: ['ALL'], status: 'planned', notes: 'Newer US prediction market. Probe required.' },
  { name: 'BetDex',              slug: 'betdex',             operator: 'BetDex Labs',                     url: 'https://betdex.com',                 platform: 'Solana-based exchange',      category: 'exchange', states: ['GRAY'], status: 'planned', notes: 'On-chain order-book exchange on Solana. Shape very different from a sportsbook — would need a chain-based adapter, not HTTP.' },
  { name: 'BetOpenly',           slug: 'betopenly',          operator: 'BetOpenly Inc.',                  url: 'https://betopenly.com',              platform: 'P2P exchange',               category: 'exchange', states: ['CO','NJ','OH'], status: 'planned', notes: 'Peer-to-peer. Small liquidity so far but real US footprint.' },
  { name: 'Rebet',               slug: 'rebet',              operator: 'Rebet Inc.',                      url: 'https://rebet.app',                  platform: 'Social / P2P',               category: 'exchange', states: ['MOST'], status: 'planned', notes: 'Social-betting app with a peer market layer. Mobile-first API (auth tokens).' },
  { name: 'Coinbase Derivatives', slug: 'coinbase-derivatives', operator: 'Coinbase',                     url: 'https://www.coinbase.com/predictions', platform: 'Kalshi-powered',           category: 'exchange', states: ['ALL'], status: 'covered', notes: 'Coinbase\'s event-contract product routes through Kalshi (same contracts, re-priced). Reuse Kalshi feed.' },
  { name: 'Crypto.com Markets',  slug: 'crypto-com-markets', operator: 'Crypto.com',                      url: 'https://crypto.com',                 platform: 'Proprietary',                category: 'exchange', states: ['ALL'], status: 'planned', notes: 'Event contracts via CFTC-licensed entity. Sports depth low vs. Kalshi/Polymarket today. Ship later.' },

  // ── Sweepstakes / promo "books" (limited real-money signal) ──────────
  { name: 'Sportzino',           slug: 'sportzino',          operator: 'Sportzino Inc.',                  url: 'https://sportzino.com',              platform: 'Sweepstakes',                category: 'dfs-sweepstakes', states: ['MOST'], status: 'planned', notes: 'Sweeps model. Limited EV value; low priority.' },
  { name: 'Thrillzz',            slug: 'thrillzz',           operator: 'Thrillzz',                        url: 'https://thrillzz.com',               platform: 'Sweepstakes',                category: 'dfs-sweepstakes', states: ['MOST'], status: 'planned', notes: 'Small sweeps operator. Tier 4+.' },
]

function StatusPill({ status }: { status: ImplStatus }) {
  const config: Record<ImplStatus, { label: string; bg: string; text: string }> = {
    live:        { label: 'Live',        bg: 'bg-green-500/10 border-green-500/20', text: 'text-green-400' },
    partial:     { label: 'Partial',     bg: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-400' },
    in_progress: { label: 'In Progress', bg: 'bg-blue-500/10 border-blue-500/20',  text: 'text-blue-400' },
    planned:     { label: 'Planned',     bg: 'bg-nb-800 border-nb-700',             text: 'text-nb-400' },
    blocked:     { label: 'Blocked',     bg: 'bg-red-500/10 border-red-500/20',     text: 'text-red-400' },
    dead:        { label: 'Dead',        bg: 'bg-nb-900 border-nb-700',             text: 'text-nb-600' },
    covered:     { label: 'Covered (CA)', bg: 'bg-sky-500/10 border-sky-500/20',     text: 'text-sky-400' },
  }
  const c = config[status]
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

function DeployPill({ target }: { target: DeployTarget }) {
  if (target === 'unknown') return <span className="text-nb-700">—</span>
  const config = {
    railway: { label: 'Railway', bg: 'bg-violet-500/10',  text: 'text-violet-400' },
    vercel:  { label: 'Vercel',  bg: 'bg-sky-500/10',     text: 'text-sky-400' },
  }[target]
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  )
}

function CategoryPill({ category }: { category: UsaCategory }) {
  const config: Record<UsaCategory, { label: string; bg: string; text: string }> = {
    major:            { label: 'Major',     bg: 'bg-green-500/10',  text: 'text-green-400' },
    regional:         { label: 'Regional',  bg: 'bg-amber-500/10',  text: 'text-amber-400' },
    exchange:         { label: 'Exchange',  bg: 'bg-violet-500/10', text: 'text-violet-400' },
    'dfs-sweepstakes': { label: 'DFS/Sweeps', bg: 'bg-sky-500/10',  text: 'text-sky-400' },
    offshore:         { label: 'Offshore',  bg: 'bg-red-500/10',    text: 'text-red-400' },
  }
  const c = config[category]
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single()

  if (!profile?.is_admin) redirect('/dashboard')

  // Summary stats
  const [
    { count: totalUsers },
    { count: proUsers },
    { data: sources },
    { count: activeAlerts },
  ] = await Promise.all([
    supabase.from('profiles').select('*', { count: 'exact', head: true }),
    supabase.from('profiles').select('*', { count: 'exact', head: true })
      .eq('subscription_tier', 'pro').eq('subscription_status', 'active'),
    supabase.from('market_sources').select('id, name, health_status, is_active').order('display_order'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('status', 'active'),
  ])

  const healthySources = sources?.filter((s) => s.health_status === 'healthy').length ?? 0
  const degradedSources = sources?.filter((s) => s.health_status !== 'healthy' && s.is_active).length ?? 0

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[1000px]">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-white">Admin Panel</h1>
        <Badge variant="white" className="text-[10px]">ADMIN</Badge>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-4">
        {[
          { label: 'Total Users', value: totalUsers ?? 0 },
          { label: 'Pro Subscribers', value: proUsers ?? 0 },
          { label: 'Active Alerts', value: activeAlerts ?? 0 },
          { label: 'Sources Online', value: `${healthySources}/${sources?.length ?? 0}`, warn: degradedSources > 0 },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-[10px] text-nb-400 uppercase tracking-wider mb-1">{stat.label}</p>
              <p className={`text-2xl font-bold font-mono ${(stat as any).warn ? 'text-nb-300' : 'text-white'}`}>
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Source health quick view */}
      {degradedSources > 0 && (
        <div className="rounded-lg border border-border bg-nb-900 p-4">
          <p className="text-xs font-semibold text-white mb-3">Source Health Issues</p>
          <div className="space-y-2">
            {sources?.filter((s) => s.health_status !== 'healthy' && s.is_active).map((s) => (
              <div key={s.id} className="flex items-center justify-between">
                <span className="text-xs text-nb-300">{s.name}</span>
                <Badge variant={s.health_status === 'degraded' ? 'degraded' : 'down_status'} className="text-[10px]">
                  {s.health_status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin sections */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ADMIN_SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <Link key={section.href} href={section.href}>
              <Card className="hover:border-nb-500 transition-colors cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-nb-800">
                        <Icon className="h-4 w-4 text-nb-300" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{section.label}</p>
                        <p className="text-xs text-nb-400">{section.desc}</p>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-nb-500 shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {/* Canadian Book Implementation Tracker */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Canadian Book Implementation Tracker</h2>
            <p className="text-[10px] text-nb-500 mt-0.5">
              {CA_BOOK_TRACKER.filter(b => b.status === 'live').length} live · {CA_BOOK_TRACKER.filter(b => b.status === 'partial').length} partial · {CA_BOOK_TRACKER.filter(b => b.status === 'in_progress').length} discovery · {CA_BOOK_TRACKER.filter(b => b.status === 'blocked').length} blocked · {CA_BOOK_TRACKER.filter(b => b.status === 'planned').length} planned
            </p>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 rounded-full bg-nb-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400"
                style={{ width: `${Math.round((CA_BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial').length / CA_BOOK_TRACKER.length) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-nb-400 font-mono">
              {Math.round((CA_BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial').length / CA_BOOK_TRACKER.length) * 100)}%
            </span>
          </div>
        </div>

        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nb-800">
                    {['Book', 'Platform', 'Deployed', 'Difficulty', 'Status', 'Game', 'Props', 'Frequency', 'Notes'].map(col => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CA_BOOK_TRACKER.map(book => (
                    <tr key={book.slug} className={`border-b border-border/30 hover:bg-nb-800/20 ${
                      book.status === 'live' ? 'border-l-2 border-l-green-500/40' :
                      book.status === 'partial' ? 'border-l-2 border-l-amber-500/40' :
                      book.status === 'in_progress' ? 'border-l-2 border-l-blue-500/40' :
                      book.status === 'blocked' ? 'border-l-2 border-l-red-500/40' : ''
                    }`}>
                      <td className="px-3 py-2">
                        <p className="text-xs font-semibold text-white">{book.name}</p>
                        <p className="text-[10px] text-nb-600 font-mono">{book.slug}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          book.platform === 'Kambi' ? 'bg-violet-500/10 text-violet-400' :
                          book.platform.includes('Entain') ? 'bg-blue-500/10 text-blue-400' :
                          'bg-nb-800 text-nb-400'
                        }`}>
                          {book.platform}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <DeployPill target={book.deployedTo} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-[10px] font-semibold ${
                          book.difficulty === 'easy' ? 'text-green-400' :
                          book.difficulty === 'medium' ? 'text-amber-400' :
                          'text-red-400'
                        }`}>
                          {book.difficulty}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill status={book.status} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {book.gameLevel
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 inline" />
                          : <span className="text-nb-700">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-center">
                        {book.props
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-400 inline" />
                          : <span className="text-nb-700">—</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        {book.frequency
                          ? <span className="text-[10px] font-mono text-green-400">{book.frequency}</span>
                          : <span className="text-nb-700">—</span>
                        }
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        <span className="text-[10px] text-nb-500">{book.notes}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* USA Book Implementation Tracker */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">USA Book Implementation Tracker</h2>
            <p className="text-[10px] text-nb-500 mt-0.5">
              {USA_BOOK_TRACKER.length} US books catalogued ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.category === 'major').length} majors ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.category === 'regional').length} regionals ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.category === 'exchange').length} exchanges ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.category === 'dfs-sweepstakes').length} DFS/sweeps ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.category === 'offshore').length} offshore
            </p>
            <p className="text-[10px] text-nb-500 mt-0.5">
              <span className="text-sky-400 font-semibold">{USA_BOOK_TRACKER.filter(b => b.status === 'covered').length} covered by CA adapter</span> ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.status === 'planned').length} still need US work ·{' '}
              {USA_BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial').length} producing
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-32 h-2 rounded-full bg-nb-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-500 to-green-400"
                // "Handled" = live + partial + covered-by-CA (all three
                // produce lines, just via different adapters).
                style={{ width: `${Math.round((USA_BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial' || b.status === 'covered').length / USA_BOOK_TRACKER.length) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-nb-400 font-mono">
              {Math.round((USA_BOOK_TRACKER.filter(b => b.status === 'live' || b.status === 'partial' || b.status === 'covered').length / USA_BOOK_TRACKER.length) * 100)}%
            </span>
          </div>
        </div>

        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nb-800">
                    {['Book', 'Operator', 'Platform', 'Category', 'States', 'Status', 'Notes'].map(col => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {USA_BOOK_TRACKER.map(book => (
                    <tr key={book.slug} className={`border-b border-border/30 hover:bg-nb-800/20 ${
                      book.status === 'live' ? 'border-l-2 border-l-green-500/40' :
                      book.status === 'partial' ? 'border-l-2 border-l-amber-500/40' :
                      book.status === 'in_progress' ? 'border-l-2 border-l-blue-500/40' : ''
                    }`}>
                      <td className="px-3 py-2">
                        <a
                          href={book.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-white hover:underline"
                        >
                          {book.name}
                        </a>
                        <p className="text-[10px] text-nb-600 font-mono">{book.slug}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] text-nb-400">{book.operator}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-nb-800 text-nb-400">
                          {book.platform}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <CategoryPill category={book.category} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] text-nb-500 font-mono">
                          {book.states.length > 8
                            ? `${book.states.length} states`
                            : book.states.join(', ')}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill status={book.status} />
                      </td>
                      <td className="px-3 py-2 max-w-[300px]">
                        <span className="text-[10px] text-nb-500">{book.notes}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roadmap — what to ship next, grouped by tier */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-bold text-white">Roadmap by Tier</h2>
          <p className="text-[10px] text-nb-500 mt-0.5">
            Books still to ship, ordered by priority. Tier 1 = biggest user-visible coverage lift.
            Skips anything already live / covered.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([1, 2, 3, 4, 5] as const).map(tier => {
            const books = USA_BOOK_TRACKER.filter(b => TIER_BY_SLUG[b.slug] === tier)
            if (books.length === 0) return null
            const tierMeta: Record<number, { label: string; desc: string; accent: string }> = {
              1: { label: 'Tier 1',  desc: 'Major US books — biggest coverage lift.',    accent: 'border-l-green-500/60 bg-green-500/5' },
              2: { label: 'Tier 2',  desc: 'Prediction-market exchanges.',              accent: 'border-l-violet-500/60 bg-violet-500/5' },
              3: { label: 'Tier 3',  desc: 'Additional offshore reduced-juice books.',  accent: 'border-l-red-500/60 bg-red-500/5' },
              4: { label: 'Tier 4',  desc: 'US regionals — narrow-footprint.',           accent: 'border-l-amber-500/60 bg-amber-500/5' },
              5: { label: 'Tier 5',  desc: 'CA-only additions.',                         accent: 'border-l-sky-500/60 bg-sky-500/5' },
            }
            const meta = tierMeta[tier]
            return (
              <Card key={tier} className={`bg-nb-900 border-nb-800 border-l-4 ${meta.accent}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs flex items-center justify-between">
                    <span>{meta.label} · {books.length}</span>
                    <span className="text-[10px] font-normal text-nb-500">{meta.desc}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y divide-border/40">
                    {books.map(b => (
                      <div key={b.slug} className="px-3 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <a href={b.url} target="_blank" rel="noopener noreferrer"
                            className="text-xs font-semibold text-white hover:underline">
                            {b.name}
                          </a>
                          <p className="text-[10px] text-nb-500 truncate">{b.platform}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <CategoryPill category={b.category} />
                          <StatusPill status={b.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
