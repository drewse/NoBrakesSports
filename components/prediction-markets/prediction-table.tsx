'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type SortingState, type ColumnDef,
} from '@tanstack/react-table'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  formatPredictionPrice, formatImpliedProb, formatDivergence,
  formatVolume, formatRelativeTime, getDivergenceColor, getMarketShape,
} from '@/lib/utils'
import type { PredictionMarketSnapshot } from '@/types'

// League abbreviation -> slug mapping for shape detection
const ABBREV_TO_SLUG: Record<string, string> = {
  EPL: 'epl',
  MLS: 'mls',
  'NCAA Soccer': 'ncaasoccer',
}

/**
 * Returns true if the prediction row's linked sportsbook event is a 3-way
 * market (soccer h2h). In that case the sportsbook_implied_prob is the home
 * win probability only — comparing it directly to a yes/no prediction market
 * probability is misleading and must be suppressed.
 */
function isThreeWayEvent(prediction: PredictionMarketSnapshot): boolean {
  const event = (prediction as any).event
  if (!event) return false
  const abbrev: string = event?.league?.abbreviation ?? ''
  const leagueSlug = ABBREV_TO_SLUG[abbrev] ?? abbrev.toLowerCase()
  const shape = getMarketShape(leagueSlug || null, null, 'moneyline')
  return shape === '3way'
}

export function PredictionTable({ predictions }: { predictions: PredictionMarketSnapshot[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'divergence_pct', desc: true }])

  const columns: ColumnDef<PredictionMarketSnapshot>[] = useMemo(() => [
    {
      id: 'contract',
      header: 'Contract',
      cell: ({ row }) => {
        const p = row.original
        const event = (p as any).event
        return (
          <div className="min-w-[180px]">
            <p className="text-sm font-medium text-white leading-snug">{p.contract_title}</p>
            {event && <p className="text-[10px] text-nb-400 mt-0.5">{event.title}</p>}
          </div>
        )
      },
    },
    {
      id: 'platform',
      header: 'Platform',
      cell: ({ row }) => {
        const source = (row.original as any).source
        return <span className="text-xs text-nb-300">{source?.name ?? '—'}</span>
      },
    },
    {
      accessorKey: 'yes_price',
      header: 'Yes',
      cell: ({ getValue }) => (
        <div>
          <p className="text-sm font-mono font-semibold text-white">{formatPredictionPrice(getValue() as number)}</p>
          <p className="text-[10px] text-nb-400">{formatImpliedProb(getValue() as number)}</p>
        </div>
      ),
    },
    {
      accessorKey: 'no_price',
      header: 'No',
      cell: ({ getValue }) => (
        <span className="text-xs font-mono text-nb-300">{formatPredictionPrice(getValue() as number)}</span>
      ),
    },
    {
      accessorKey: 'sportsbook_implied_prob',
      header: 'Sportsbook',
      cell: ({ row }) => {
        const p = row.original
        // Suppress sportsbook prob display for 3-way markets — the stored
        // implied_prob is the home-win prob only, not comparable to a
        // binary yes/no prediction market contract.
        if (isThreeWayEvent(p)) {
          return (
            <div>
              <p className="text-xs font-mono text-nb-500">—</p>
              <p className="text-[10px] text-nb-600">3-way market</p>
            </div>
          )
        }
        return (
          <div>
            <p className="text-xs font-mono text-nb-200">{formatImpliedProb(p.sportsbook_implied_prob)}</p>
            {(p as any).sportsbook_source && (
              <p className="text-[10px] text-nb-500">{(p as any).sportsbook_source.name}</p>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: 'divergence_pct',
      id: 'divergence_pct',
      header: 'Divergence',
      sortingFn: (a, b) =>
        Math.abs(b.original.divergence_pct ?? 0) - Math.abs(a.original.divergence_pct ?? 0),
      cell: ({ row }) => {
        const p = row.original
        // Suppress divergence entirely for 3-way markets — the comparison is
        // invalid because sportsbook_implied_prob is the home-win probability
        // only, not a true binary match for yes/no prediction contracts.
        if (isThreeWayEvent(p)) {
          return (
            <span className="text-xs text-nb-600" title="Divergence unavailable: 3-way market">
              —
            </span>
          )
        }
        const val = p.divergence_pct
        return (
          <div className="flex items-center gap-1.5">
            {val != null && val > 1 && <TrendingUp className="h-3.5 w-3.5 text-white" />}
            {val != null && val < -1 && <TrendingDown className="h-3.5 w-3.5 text-nb-300" />}
            <span className={`text-xs font-mono font-semibold ${getDivergenceColor(val)}`}>
              {formatDivergence(val)}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'total_volume',
      header: 'Volume',
      cell: ({ getValue }) => (
        <span className="text-xs font-mono text-nb-400">{formatVolume(getValue() as number)}</span>
      ),
    },
    {
      accessorKey: 'snapshot_time',
      header: 'Updated',
      cell: ({ getValue }) => (
        <span className="text-[10px] text-nb-500 font-mono whitespace-nowrap">
          {formatRelativeTime(getValue() as string)}
        </span>
      ),
    },
  ], [])

  const table = useReactTable({
    data: predictions,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-nb-900/60">
                {hg.headers.map((header) => (
                  <th key={header.id}
                    className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors whitespace-nowrap"
                    onClick={header.column.getToggleSortingHandler()}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-border/50 hover:bg-nb-800/30 transition-colors">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-3">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-sm text-nb-400">
                  No prediction market data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-3 border-t border-border bg-nb-900/30">
        <p className="text-xs text-nb-500">{predictions.length} contracts · Informational purposes only</p>
      </div>
    </div>
  )
}
