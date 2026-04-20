import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createLogger } from './logger.js'

const log = createLogger('supabase')

let cached: SupabaseClient | null = null

function sanitize(v: string | undefined): string {
  return (v ?? '').replace(/^\s+|\s+$/g, '').replace(/^["']|["']$/g, '')
}

export function getSupabase(): SupabaseClient {
  if (cached) return cached
  let url = sanitize(process.env.SUPABASE_URL)
  const key = sanitize(process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  // Add scheme if missing
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  // Drop trailing slash (Supabase REST appends paths)
  url = url.replace(/\/+$/, '')

  // Validate URL parses cleanly
  try {
    // eslint-disable-next-line no-new
    new URL(url)
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL after sanitization: ${JSON.stringify(url)}`)
  }

  log.info('supabase client init', {
    host: new URL(url).host,
    keyLen: key.length,
  })

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { 'x-nobrakes-client': 'worker' },
      // Node's built-in fetch, with a generous timeout to survive Railway cold networking.
      fetch: (input, init) => {
        const ctrl = new AbortController()
        const timeout = setTimeout(() => ctrl.abort(), 20_000)
        return fetch(input, { ...init, signal: ctrl.signal })
          .catch((err) => {
            log.error('fetch failed against supabase', {
              url: typeof input === 'string' ? input : String(input),
              message: (err as Error)?.message ?? String(err),
            })
            throw err
          })
          .finally(() => clearTimeout(timeout))
      },
    },
  })
  return cached
}
