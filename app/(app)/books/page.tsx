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
    // Show every active sportsbook / prediction-market source. is_active
    // already filters dead/planned seed rows; health_status was previously
    // also gated to 'healthy' but most cron writers never bump that field
    // off the default 'unknown', so books like Betano / Proline / theScore /
    // partypoker / BetMGM ON / Bet99 were silently hidden even though they
    // were producing data.
    supabase
      .from('market_sources')
      .select('name, slug')
      .in('source_type', ['sportsbook', 'prediction_market'])
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
