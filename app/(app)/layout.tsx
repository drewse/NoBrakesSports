import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import type { Profile } from '@/types'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // Auth check must happen first (need user.id for profile query)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // ALL remaining queries in parallel — profile + sources + pipelines + cookies
  const cookieStore = await cookies()
  const [{ data: profile }, { data: sourcesRaw }, { data: pipelinesRaw }] = await Promise.all([
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single(),
    supabase
      .from('market_sources')
      .select('name, slug')
      .eq('source_type', 'sportsbook')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
    supabase
      .from('data_pipelines')
      .select('slug')
      .eq('source_type', 'sportsbook'),
  ])

  const sources = sourcesRaw ?? []
  const canadianSlugs = (pipelinesRaw ?? []).map((p: any) => p.slug)

  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooksSet = parseEnabledBooks(enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined)
  const initialEnabledBooks = enabledBooksSet ? [...enabledBooksSet] : null

  return (
    <div className="flex h-screen overflow-hidden bg-nb-950">
      <Sidebar profile={profile as Profile | null} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          profile={profile as Profile | null}
          sources={sources}
          initialEnabledBooks={initialEnabledBooks}
          canadianSlugs={canadianSlugs}
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
