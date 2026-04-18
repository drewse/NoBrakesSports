import Link from 'next/link'
import { ChevronRight, TrendingUp, TrendingDown } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDivergence, formatPredictionPrice } from '@/lib/utils'
import { BookLogo } from '@/components/shared/book-logo'
import type { PredictionMarketSnapshot } from '@/types'

interface DivergenceCardProps {
  predictions: PredictionMarketSnapshot[]
}

export function DivergenceCard({ predictions }: DivergenceCardProps) {
  const sorted = [...predictions]
    .filter(p => p.divergence_pct != null)
    .sort((a, b) => Math.abs(b.divergence_pct!) - Math.abs(a.divergence_pct!))
    .slice(0, 4)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b border-border pb-4">
        <CardTitle>Top Divergences</CardTitle>
        <Button asChild variant="ghost" size="sm" className="text-nb-400 h-7">
          <Link href="/prediction-markets">
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {sorted.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-nb-400">No divergence data</div>
        ) : (
          <div className="divide-y divide-border">
            {sorted.map((p) => {
              const div = p.divergence_pct ?? 0
              const isPositive = div > 0
              return (
                <div key={p.id} className="px-4 py-3 hover:bg-nb-800/40 transition-colors">
                  <p className="text-xs font-medium text-white truncate mb-1">
                    {(p as any).event?.title ?? p.contract_title}
                  </p>
                  <div className="flex items-center justify-between">
                    <BookLogo name={(p as any).source?.slug ?? (p as any).source?.name ?? '—'} size="xs" />
                    <div className="flex items-center gap-1">
                      {isPositive ? (
                        <TrendingUp className="h-3 w-3 text-white" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-nb-300" />
                      )}
                      <span className={`text-xs font-mono font-semibold ${Math.abs(div) >= 5 ? 'text-white' : 'text-nb-300'}`}>
                        {formatDivergence(div)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-nb-500">Yes: {formatPredictionPrice(p.yes_price)}</span>
                    <span className="text-[10px] text-nb-500">
                      Sportsbook: {p.sportsbook_implied_prob != null ? `${(p.sportsbook_implied_prob * 100).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
