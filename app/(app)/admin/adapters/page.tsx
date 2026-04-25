import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Plug } from 'lucide-react'

export const metadata = { title: 'Admin · Adapters' }
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────
// Adapter board — five-column view of every book on our radar.
//
// Buckets are derived from two sources of truth:
//   1. worker/src/index.ts ALL_ADAPTERS — what's actually scheduled on
//      Railway (commented-out lines = paused).
//   2. worker/src/adapters/<book>.ts useProxy: option — which proxy tier
//      the adapter would use if it ran. PacketStream covers `useProxy:
//      true` (CA) and `useProxy: 'us'` (US); IPRoyal covers
//      `useProxy: 'mobile'` (CA) and `useProxy: 'us-mobile'` (US).
//   3. The Vercel /api/cron/sync-* routes — direct-IP, no proxy.
//
// Editing this file is the way to keep the board in sync with what
// actually ships. Re-classify by moving an entry between arrays; the
// columns render in declaration order.

interface BookEntry {
  name: string
  /** Optional one-line context — surfaces under the name in the cell. */
  note?: string
}

const PACKETSTREAM_LIVE: BookEntry[] = [
  { name: 'BetMGM ON',  note: 'Entain CDS · Railway' },
  { name: '888sport',   note: 'Spectate · Railway' },
  { name: 'Betano',     note: 'Kaizen SSR · Railway' },
  { name: 'TonyBet',    note: 'BetConstruct · Railway' },
  { name: 'Betovo',     note: 'CA discovery · Railway' },
  { name: 'Sports Interaction', note: 'Entain CDS · Railway · NBA/MLB/NHL game lines + props · awaiting first cycle' },
]

const IPROYAL_LIVE: BookEntry[] = [
  { name: 'BET99',      note: 'SBTech · Railway · discovery' },
  { name: 'TitanPlay',  note: 'Ontario · Railway · discovery' },
  { name: 'Stake.us',   note: 'CF-gated sweeps · Railway · discovery' },
]

const NO_PROXY_LIVE: BookEntry[] = [
  // Vercel cron pipeline
  { name: 'BetRivers ON',     note: 'Kambi · Vercel' },
  { name: 'Unibet CA',        note: 'Kambi · Vercel' },
  { name: 'LeoVegas',         note: 'Kambi · Vercel' },
  { name: 'NorthStar Bets',   note: 'Kambi · Vercel' },
  { name: 'FanDuel',          note: 'FD API · Vercel' },
  { name: 'Betway',           note: 'Betway API · Vercel' },
  { name: 'DraftKings',       note: 'DK API · Vercel' },
  { name: 'bwin',             note: 'Entain CDS · Vercel' },
  { name: 'partypoker',       note: 'Entain CDS · Vercel' },
  { name: 'Bovada',           note: 'Vercel cron' },
  { name: 'PrizePicks',       note: 'DFS · Vercel cron' },
  { name: 'Sleeper Picks',    note: 'DFS · Vercel cron' },
  { name: 'Kalshi',           note: 'Prediction · Vercel cron' },
  { name: 'Polymarket',       note: 'Prediction · Vercel cron' },
  { name: 'Fanatics Markets', note: 'Prediction · Vercel cron' },
  { name: 'DraftKings Predictions', note: 'Prediction · Vercel cron · 5 min · NBA only · seeded ticker list, listing endpoint TBD' },
  // Railway direct-IP
  { name: 'PointsBet ON',     note: 'PointsBet API · Railway' },
  { name: 'Pinnacle',         note: 'Pinnacle API · Railway' },
  { name: 'Proline (OLG)',    note: 'Kambi public CDN · Railway' },
  { name: 'Bally Bet',        note: 'Kambi public CDN · Railway' },
  { name: 'Novig',            note: 'Exchange · Railway' },
  { name: 'Circa Sports',     note: 'Direct IP · Railway' },
]

const PAUSED: BookEntry[] = [
  // Disabled in worker/index.ts to cut mobile-proxy spend
  { name: 'Caesars',         note: 'IPRoyal CA · disabled — proxy spend' },
  { name: 'theScore Bet',    note: 'IPRoyal CA · disabled — proxy spend' },
  { name: 'BetVictor',       note: 'IPRoyal CA · disabled — proxy spend' },
  { name: 'Hard Rock Bet',   note: 'IPRoyal US · disabled — proxy spend' },
  // Adapter shipped but blocked / awaiting unlock
  { name: 'bet365',          note: 'WSS-only transport — parked' },
  { name: 'BetParx',         note: 'CF-blocked · awaits IPRoyal US' },
  { name: 'BetOnline',       note: 'CF-blocked · awaits IPRoyal US' },
  { name: 'LowVig',          note: 'CF-blocked · awaits IPRoyal US' },
  { name: 'Sportsbetting.ag', note: 'CF-blocked · awaits IPRoyal US' },
  { name: 'PowerPlay',       note: 'TCP-drop on PacketStream · awaits IPRoyal CA' },
  { name: 'Miseojeu',        note: 'TCP-drop on PacketStream · awaits IPRoyal CA' },
  { name: 'Crypto.com Markets', note: 'Cloudflare 403 from datacenter, page is RSC-only · needs Playwright + IPRoyal' },
  // Discovery-only / partial — running but not producing markets yet
  { name: 'BetMGM ON props', note: 'Markets endpoint broken · events flow' },
  { name: 'MyBookie',        note: 'Discovery · awaits PROXY_URL_US' },
  { name: 'Bookmaker.eu',    note: 'Discovery · awaits PROXY_URL_US' },
  { name: 'BetUS',           note: 'Discovery · awaits PROXY_URL_US' },
  { name: 'Sportzino',       note: 'Discovery · Railway' },
  { name: 'Prophet Exchange', note: 'Auth-gated · parked' },
  { name: 'Underdog Fantasy', note: 'Awaiting first cron fire' },
]

const REMOVED: BookEntry[] = [
  { name: 'Casumo',      note: 'No CA sportsbook product · confirmed 2026-04-22' },
  { name: 'Jackpot.bet', note: 'Domain parked / dead · confirmed via discovery log' },
  { name: 'Unibet US',   note: 'Kindred exited US market · May 2024' },
]

const NOT_IMPLEMENTED: BookEntry[] = [
  // US majors / regionals not yet started
  { name: 'Betfred Sports',     note: 'US regional · planned' },
  { name: 'Betly',              note: 'US regional · planned' },
  { name: 'WynnBET',            note: 'US regional · planned' },
  { name: 'Tipico US',          note: 'US regional · NJ' },
  { name: 'Desert Diamond',     note: 'AZ tribal · planned' },
  { name: 'FireKeepers',        note: 'MI tribal · planned' },
  { name: 'Four Winds',         note: 'MI tribal · planned' },
  { name: 'Eagle Sports',       note: 'MI tribal · planned' },
  { name: 'Island Resort',      note: 'MI tribal · planned' },
  { name: 'Ocean Casino',       note: 'NJ · planned' },
  { name: 'Resorts World Bet',  note: 'NY · planned' },
  { name: 'Betsson US',         note: 'CO-only · planned' },
  // Exchanges / prediction markets
  { name: 'Sporttrade',         note: 'Exchange · planned' },
  { name: 'Onyx Odds',          note: 'Exchange · planned' },
  { name: 'BetDex',             note: 'Solana exchange · planned' },
  { name: 'BetOpenly',          note: 'P2P exchange · planned' },
  { name: 'Rebet',               note: 'Social P2P · planned' },
  // DFS / sweepstakes
  { name: 'Fliff',              note: 'Sweepstakes · planned' },
  { name: 'Sportzino US',       note: 'Sweepstakes · planned' },
  { name: 'Thrillzz',           note: 'Sweepstakes · planned' },
  // Offshore
  { name: 'BetAnySports',       note: 'Offshore reduced juice · planned' },
  { name: '1XBet',              note: 'Offshore gray-market · planned' },
  { name: 'BetCris',            note: 'LatAm offshore · planned' },
]

const COLUMNS: Array<{
  title: string
  subtitle: string
  tone: 'green' | 'sky' | 'violet' | 'amber' | 'nb' | 'red'
  entries: BookEntry[]
}> = [
  { title: 'Live · PacketStream',  subtitle: 'Residential CA / US',   tone: 'green',  entries: PACKETSTREAM_LIVE },
  { title: 'Live · IPRoyal',       subtitle: 'Mobile CA / US',        tone: 'violet', entries: IPROYAL_LIVE },
  { title: 'Live · No proxy',      subtitle: 'Vercel + direct IP',    tone: 'sky',    entries: NO_PROXY_LIVE },
  { title: 'Paused',               subtitle: 'Adapter shipped',       tone: 'amber',  entries: PAUSED },
  { title: 'Not yet implemented',  subtitle: 'Planned / next up',     tone: 'nb',     entries: NOT_IMPLEMENTED },
  { title: 'Removed',              subtitle: 'Dead · no longer tracked', tone: 'red', entries: REMOVED },
]

const TONE: Record<typeof COLUMNS[number]['tone'], { dot: string; chip: string }> = {
  green:  { dot: 'bg-green-400',  chip: 'bg-green-500/10 text-green-400 border-green-500/20' },
  violet: { dot: 'bg-violet-400', chip: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  sky:    { dot: 'bg-sky-400',    chip: 'bg-sky-500/10 text-sky-400 border-sky-500/20' },
  amber:  { dot: 'bg-amber-400',  chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  nb:     { dot: 'bg-nb-500',     chip: 'bg-nb-800 text-nb-300 border-nb-700' },
  red:    { dot: 'bg-red-400',    chip: 'bg-red-500/10 text-red-400 border-red-500/20' },
}

export default async function AdaptersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/dashboard')

  const totals = COLUMNS.reduce((sum, c) => sum + c.entries.length, 0)

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center gap-2">
        <Plug className="h-5 w-5 text-nb-400" />
        <h1 className="text-lg font-bold text-white">Adapters</h1>
        <span className="text-[10px] font-mono text-nb-500">{totals} books tracked</span>
      </div>

      <p className="text-xs text-nb-400 max-w-3xl leading-relaxed">
        Every book on our radar, bucketed by what it takes to keep it
        running. Source of truth: <span className="text-nb-200 font-mono">worker/src/index.ts</span>{' '}
        for Railway, the <span className="text-nb-200 font-mono">/api/cron/*</span> routes for
        Vercel. Edit{' '}
        <span className="text-nb-200 font-mono">app/(app)/admin/adapters/page.tsx</span>{' '}
        when an adapter ships, gets paused, or rotates proxies.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3 sm:gap-4">
        {COLUMNS.map(col => {
          const tone = TONE[col.tone]
          return (
            <Card key={col.title} className="bg-nb-900/40 border-nb-800">
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      <p className="text-xs font-bold text-white tracking-tight">{col.title}</p>
                    </div>
                    <p className="text-[10px] text-nb-500 mt-0.5">{col.subtitle}</p>
                  </div>
                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${tone.chip}`}>
                    {col.entries.length}
                  </span>
                </div>
                <ul className="divide-y divide-border/40">
                  {col.entries.map(b => (
                    <li key={b.name} className="px-4 py-2.5">
                      <p className="text-xs font-semibold text-white truncate">{b.name}</p>
                      {b.note && (
                        <p className="text-[10px] text-nb-500 mt-0.5 leading-snug">{b.note}</p>
                      )}
                    </li>
                  ))}
                  {col.entries.length === 0 && (
                    <li className="px-4 py-6 text-[10px] text-nb-600 text-center">
                      Nothing here yet.
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
