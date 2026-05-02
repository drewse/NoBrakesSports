'use client'

import { useEffect, useState, useCallback } from 'react'

/**
 * Single source of truth for the user's bankroll. Persisted to
 * localStorage under one key so the value entered on /bankroll is the
 * same value used by both the arb calculator's Kelly sizing and the
 * +EV calculator's Kelly toggle.
 *
 * Earlier we had two separate keys (nb-arb-bankroll, nb-ev-bankroll)
 * which let users accidentally hold two different bankrolls — typing
 * $500 on /arbitrage and $1000 on /top-lines and getting different
 * Kelly recommendations on identical bets. This hook reads from the
 * canonical key and falls back to either of the legacy keys exactly
 * once for migration, so existing users don't lose their saved value.
 *
 * Cross-tab sync: a `storage` event listener picks up changes from
 * other tabs (e.g. the user updates bankroll on /bankroll while
 * /arbitrage is open in another tab — the second tab updates without
 * a reload).
 */

const KEY = 'nb-bankroll'
const LEGACY_KEYS = ['nb-arb-bankroll', 'nb-ev-bankroll']
const DEFAULT_BANKROLL = 1000

function readInitial(): number {
  if (typeof window === 'undefined') return DEFAULT_BANKROLL
  const direct = window.localStorage.getItem(KEY)
  if (direct) {
    const v = parseFloat(direct)
    if (Number.isFinite(v) && v > 0) return v
  }
  // One-shot migration from the per-page keys.
  for (const legacy of LEGACY_KEYS) {
    const raw = window.localStorage.getItem(legacy)
    if (raw) {
      const v = parseFloat(raw)
      if (Number.isFinite(v) && v > 0) {
        window.localStorage.setItem(KEY, String(v))
        return v
      }
    }
  }
  return DEFAULT_BANKROLL
}

export function useBankroll(): [number, (next: number) => void] {
  // Stable initial render between server + client: always start at
  // DEFAULT_BANKROLL on the server, hydrate from localStorage on the
  // client effect below. Avoids hydration mismatch warnings.
  const [bankroll, setBankrollState] = useState<number>(DEFAULT_BANKROLL)

  useEffect(() => {
    setBankrollState(readInitial())
  }, [])

  // Cross-tab sync.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return
      const v = e.newValue != null ? parseFloat(e.newValue) : NaN
      if (Number.isFinite(v) && v > 0) setBankrollState(v)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setBankroll = useCallback((next: number) => {
    if (!Number.isFinite(next) || next < 0) return
    setBankrollState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(KEY, String(next))
      // Same-tab listeners (the native storage event only fires on
      // OTHER tabs). Synthetic event so the arb / EV calculator in the
      // same tab picks it up if open.
      window.dispatchEvent(new StorageEvent('storage', {
        key: KEY, newValue: String(next),
      }))
    }
  }, [])

  return [bankroll, setBankroll]
}
