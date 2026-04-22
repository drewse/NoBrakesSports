import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { BOOK_FILTER_COOKIE, parseEnabledBooks } from '@/lib/book-filter'
import { BooksView } from '@/components/books/books-view'

export const metadata = { title: 'Books' }

export default async function BooksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const [{ data: sourcesRaw }, { data: pipelinesRaw }] = await Promise.all([
    // Match the topbar count: only sources currently producing data.
    // Filtering by health_status='healthy' hides the ~70 planned/blocked/
    // dead seed rows that would otherwise bloat the selector. Includes
    // prediction_market type so Kalshi/Polymarket surface with real names.
    supabase
      .from('market_sources')
      .select('name, slug')
      .in('source_type', ['sportsbook', 'prediction_market'])
      .eq('is_active', true)
      .eq('health_status', 'healthy')
      .order('display_order', { ascending: true }),
    supabase
      .from('data_pipelines')
      .select('slug')
      .eq('source_type', 'sportsbook'),
  ])

  const sources = sourcesRaw ?? []
  const canadianSlugs = (pipelinesRaw ?? []).map((p: any) => p.slug)

  const enabledBooksRaw = cookieStore.get(BOOK_FILTER_COOKIE)?.value
  const enabledBooksSet = parseEnabledBooks(
    enabledBooksRaw ? decodeURIComponent(enabledBooksRaw) : undefined,
  )
  const initialEnabled = enabledBooksSet ? [...enabledBooksSet] : null

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[900px]">
      <div>
        <h1 className="text-lg font-bold text-white">Books</h1>
        <p className="text-xs text-nb-400 mt-0.5">
          Choose which sportsbooks appear across the app.
        </p>
      </div>
      <BooksView
        sources={sources}
        initialEnabled={initialEnabled}
        canadianSlugs={canadianSlugs}
      />
    </div>
  )
}
