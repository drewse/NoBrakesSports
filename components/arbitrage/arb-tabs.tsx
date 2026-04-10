'use client'

import { useState, type ReactNode } from 'react'

interface ArbTabsProps {
  gameCount: number
  propCount: number
  gameContent: ReactNode
  propContent: ReactNode
}

export function ArbTabs({ gameCount, propCount, gameContent, propContent }: ArbTabsProps) {
  const [tab, setTab] = useState<'game' | 'prop'>('game')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-nb-900 p-1 rounded-lg w-fit border border-border">
        <button
          onClick={() => setTab('game')}
          className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${
            tab === 'game'
              ? 'bg-white text-nb-950'
              : 'text-nb-400 hover:text-white'
          }`}
        >
          Game Arbs{gameCount > 0 && <span className="ml-1.5 text-[10px] opacity-70">({gameCount})</span>}
        </button>
        <button
          onClick={() => setTab('prop')}
          className={`px-4 py-1.5 text-xs font-medium rounded transition-colors ${
            tab === 'prop'
              ? 'bg-violet-600 text-white'
              : 'text-nb-400 hover:text-white'
          }`}
        >
          Prop Arbs{propCount > 0 && <span className="ml-1.5 text-[10px] opacity-70">({propCount})</span>}
        </button>
      </div>

      {tab === 'game' ? gameContent : propContent}
    </div>
  )
}
