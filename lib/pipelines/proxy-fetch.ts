// ─────────────────────────────────────────────────────────────────────────────
// Proxy-aware fetch wrapper
//
// Two PacketStream residential pools:
//   PROXY_URL     — Canadian pool  (default)
//   PROXY_URL_US  — USA pool       (opt-in per call via pool: 'us')
//
// Both env vars are full PacketStream proxy URLs; PacketStream does country
// filtering via the username suffix (e.g. user_country-ca vs user_country-us),
// so the same account powers both pools.
//
// Usage:
//   import { pipeFetch } from '@/lib/pipelines/proxy-fetch'
//   await pipeFetch(url, { headers: { ... } })             // CA pool
//   await pipeFetch(url, { headers: { ... }, pool: 'us' }) // US pool
// ─────────────────────────────────────────────────────────────────────────────

import { ProxyAgent, fetch as undiciFetch } from 'undici'

type Pool = 'ca' | 'us'

const POOL_ENV: Record<Pool, string> = {
  ca: 'PROXY_URL',
  us: 'PROXY_URL_US',
}

const agents: Partial<Record<Pool, ProxyAgent>> = {}

function getAgent(pool: Pool): ProxyAgent | null {
  const envName = POOL_ENV[pool]
  const url = process.env[envName]
  if (!url) return null
  if (!agents[pool]) agents[pool] = new ProxyAgent(url)
  return agents[pool]!
}

export async function pipeFetch(
  url: string,
  init?: {
    headers?: Record<string, string>
    method?: string
    body?: string
    signal?: AbortSignal
    pool?: Pool
  }
): Promise<Response> {
  const { signal: callerSignal, pool = 'ca', ...rest } = init ?? {}
  const agent = getAgent(pool)

  const signals: AbortSignal[] = [AbortSignal.timeout(15000)]
  if (callerSignal) signals.push(callerSignal)
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)

  if (!agent) {
    return fetch(url, { ...rest, signal })
  }

  return undiciFetch(url, {
    ...(rest as any),
    dispatcher: agent,
    signal,
  }) as unknown as Response
}
