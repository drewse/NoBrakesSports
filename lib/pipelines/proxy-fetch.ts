// ─────────────────────────────────────────────────────────────────────────────
// Proxy-aware fetch wrapper
//
// If PROXY_URL is set, routes requests through a residential proxy (PacketStream).
// Falls back to direct fetch when PROXY_URL is not set (local dev / books that
// don't block cloud IPs).
//
// Usage:
//   import { pipeFetch } from '@/lib/pipelines/proxy-fetch'
//   const res = await pipeFetch(url, { headers: { ... } })
//
// PROXY_URL format: http://username:password@proxy.packetstream.io:31112
// ─────────────────────────────────────────────────────────────────────────────

import { ProxyAgent, fetch as undiciFetch } from 'undici'

let _agent: ProxyAgent | null = null

function getAgent(): ProxyAgent | null {
  if (!process.env.PROXY_URL) return null
  if (!_agent) {
    _agent = new ProxyAgent(process.env.PROXY_URL)
  }
  return _agent
}

/**
 * Drop-in replacement for fetch() that routes through the residential proxy
 * when PROXY_URL is configured. Falls back to direct fetch otherwise.
 */
export async function pipeFetch(
  url: string,
  init?: { headers?: Record<string, string>; method?: string; body?: string; signal?: AbortSignal }
): Promise<Response> {
  const agent = getAgent()
  const { signal: callerSignal, ...rest } = init ?? {}

  // Compose caller's abort signal with our internal 15s timeout.
  // AbortSignal.any() fires whichever triggers first.
  const signals: AbortSignal[] = [AbortSignal.timeout(15000)]
  if (callerSignal) signals.push(callerSignal)
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)

  if (!agent) {
    return fetch(url, { ...rest, signal })
  }

  // undici fetch with ProxyAgent — types diverge from standard fetch, cast as needed
  return undiciFetch(url, {
    ...(rest as any),
    dispatcher: agent,
    signal,
  }) as unknown as Response
}
