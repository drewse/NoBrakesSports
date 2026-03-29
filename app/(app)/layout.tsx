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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Fetch sportsbook sources for the book filter selector (exclude prediction markets)
  const { data: sourcesRaw } = await supabase
    .from('market_sources')
    .select('name, slug')
    .eq('source_type', 'sportsbook')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  const sources = sourcesRaw ?? []

  const cookieStore = await cookies()
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
        />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
