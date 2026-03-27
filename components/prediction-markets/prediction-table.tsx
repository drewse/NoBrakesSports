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
  formatVolume, formatRelativeTime, getDivergenceColor,
} from '@/lib/utils'
import type { PredictionMarketSnapshot } from '@/types'

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
      cell: ({ getValue }) => {
        const val = getValue() as number | null
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
