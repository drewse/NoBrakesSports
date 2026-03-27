import { createClient } from '@supabase/supabase-js'

// Direct admin client — no cookies, bypasses RLS. Use only in server-side cron/API routes.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
