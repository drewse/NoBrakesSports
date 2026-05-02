'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Wallet, Check, LineChart, History } from 'lucide-react'
import { useBankroll } from '@/lib/use-bankroll'

const PRESET_AMOUNTS = [500, 1000, 2500, 5000, 10000, 25000]

export function BankrollClient() {
  const [bankroll, setBankroll] = useBankroll()
  const [draft, setDraft] = useState<string>('')
  const [savedFlash, setSavedFlash] = useState<boolean>(false)

  const display = draft !== '' ? draft : String(bankroll)

  const commit = (raw: string) => {
    const clean = raw.replace(/[^0-9.]/g, '')
    const v = parseFloat(clean)
    if (Number.isFinite(v) && v >= 0) {
      setBankroll(v)
      setDraft('')
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1200)
    }
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-[820px] space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold text-white">Bankroll</h1>
      </div>
      <p className="text-xs text-nb-400 -mt-2">
        Used for Kelly sizing recommendations on the Arbitrage and Top EV Lines pages.
        Stored locally in your browser — never sent to a server.
      </p>

      {/* Editor — large input + presets. Saves on Enter or blur. */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-nb-400" />
            <p className="text-xs font-semibold text-nb-300 uppercase tracking-wider">
              Current Bankroll
            </p>
            {savedFlash && (
              <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-semibold">
                <Check className="h-3 w-3" /> saved
              </span>
            )}
          </div>

          <div className="relative">
            <span className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-nb-400 text-2xl sm:text-3xl font-mono">
              $
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={display}
              onChange={e => setDraft(e.target.value)}
              onBlur={e => commit(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              className="w-full h-14 sm:h-16 pl-9 sm:pl-12 pr-4 rounded-xl bg-nb-800 border border-nb-700 text-white text-2xl sm:text-3xl font-mono font-bold focus:outline-none focus:ring-2 focus:ring-nb-500 focus:border-nb-500"
              aria-label="Bankroll amount"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {PRESET_AMOUNTS.map(amt => (
              <button
                key={amt}
                onClick={() => commit(String(amt))}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors font-mono ${
                  bankroll === amt
                    ? 'bg-white text-nb-950 border-white'
                    : 'bg-transparent text-nb-300 border-nb-800 hover:border-nb-600 hover:text-white'
                }`}
              >
                ${amt.toLocaleString()}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-nb-500 leading-relaxed">
            Tip: enter your TOTAL bettable bankroll, not just what you&apos;re wagering on a
            single game. Kelly sizing recommends a fraction of total bankroll per bet.
          </p>
        </CardContent>
      </Card>

      {/* Where bankroll is used */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-5 space-y-3">
          <p className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
            How it&apos;s used
          </p>
          <div className="space-y-2.5 text-[11px] text-nb-300 leading-relaxed">
            <div className="flex gap-2">
              <LineChart className="h-3.5 w-3.5 text-nb-400 shrink-0 mt-0.5" />
              <p>
                <span className="text-white font-semibold">Top EV Lines</span> — when Kelly
                Sizing is on, your stake auto-sizes to a fraction of bankroll based on the
                edge of the selected line. Toggle off to set the stake manually.
              </p>
            </div>
            <div className="flex gap-2">
              <LineChart className="h-3.5 w-3.5 text-nb-400 shrink-0 mt-0.5" />
              <p>
                <span className="text-white font-semibold">Arbitrage</span> — Kelly Sizing
                button on the calculator scales total stake to bankroll × profit-pct (capped
                at quarter-Kelly).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Coming soon — bet tracking */}
      <Card className="bg-nb-900 border-nb-800">
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-nb-800 border border-nb-700">
              <History className="h-4 w-4 text-nb-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">Bet Tracking</p>
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-nb-800 text-nb-400 border border-nb-700">
                  Coming soon
                </span>
              </div>
              <p className="text-[11px] text-nb-400 mt-1 leading-relaxed">
                Log bets, track open positions, see realized vs expected ROI, and compare
                actual bankroll movement against Kelly-sized recommendations. Surfaces
                here once shipped.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
