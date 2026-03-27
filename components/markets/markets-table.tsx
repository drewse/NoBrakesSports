'use client'

import { useState, useMemo } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table'
import { ArrowUp, ArrowDown, ArrowUpDown, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatOdds, formatImpliedProb, formatSpread, formatRelativeTime } from '@/lib/utils'
import type { MarketSnapshot } from '@/types'

interface MarketsTableProps {
  snapshots: MarketSnapshot[]
  isPro: boolean
}

export function MarketsTable({ snapshots, isPro }: MarketsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([])

  const columns: ColumnDef<MarketSnapshot>[] = useMemo(() => [
    {
      id: 'event',
      header: 'Event',
      cell: ({ row }) => {
        const event = (row.original as any).event
        return (
          <div className="min-w-[160px]">
            <p className="text-sm font-medium text-white leading-snug">{event?.title ?? '—'}</p>
            <p className="text-[10px] text-nb-400">{event?.league?.abbreviation}</p>
          </div>
        )
      },
    },
    {
      accessorKey: 'market_type',
      header: 'Type',
      cell: ({ getValue }) => (
        <Badge variant="muted" className="text-[10px] capitalize">{String(getValue())}</Badge>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      cell: ({ row }) => {
        const source = (row.original as any).source
        return <span className="text-xs text-nb-300 whitespace-nowrap">{source?.name ?? '—'}</span>
      },
    },
    {
      accessorKey: 'home_price',
      header: ({ column }) => (
        <button className="flex items-center gap-1 text-[10px] font-semibold text-nb-400 uppercase tracking-wider hover:text-white transition-colors"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}>
          Home
          {column.getIsSorted() === 'asc' ? <ArrowUp className="h-3 w-3" /> :
           column.getIsSorted() === 'desc' ? <ArrowDown className="h-3 w-3" /> :
           <ArrowUpDown className="h-3 w-3" />}
        </button>
      ),
      cell: ({ row }) => {
        const s = row.original
        if (s.market_type === 'spread') {
          return (
            <span className="text-xs font-mono text-white whitespace-nowrap">
              {formatSpread(s.spread_value)} <span className="text-nb-400">({formatOdds(s.home_price)})</span>
            </span>
          )
        }
        return <span className="text-xs font-mono text-white">{formatOdds(s.home_price)}</span>
      },
    },
    {
      accessorKey: 'draw_price',
      header: 'Draw',
      cell: ({ row }) => (
        <span className="text-xs font-mono text-nb-300">
          {(row.original as any).draw_price != null
            ? formatOdds((row.original as any).draw_price)
            : '—'}
        </span>
      ),
    },
    {
      accessorKey: 'away_price',
      header: 'Away',
      cell: ({ row }) => (
        <span className="text-xs font-mono text-nb-300">{formatOdds(row.original.away_price)}</span>
      ),
    },
    {
      accessorKey: 'home_implied_prob',
      header: 'Impl. Prob',
      cell: ({ getValue }) => (
        <span className="text-xs font-mono text-nb-300">{formatImpliedProb(getValue() as number)}</span>
      ),
    },
    {
      accessorKey: 'movement_direction',
      header: 'Move',
      cell: ({ row }) => {
        const { movement_direction: dir, movement_magnitude: mag } = row.original
        return (
          <div className="flex items-center gap-1">
            {dir === 'up' && <TrendingUp className="h-3.5 w-3.5 text-white" />}
            {dir === 'down' && <TrendingDown className="h-3.5 w-3.5 text-nb-300" />}
            {dir === 'flat' && <Minus className="h-3.5 w-3.5 text-nb-600" />}
            {mag > 0 && (
              <span className={`text-xs font-mono ${dir === 'up' ? 'text-white' : dir === 'down' ? 'text-nb-300' : 'text-nb-600'}`}>
                {mag.toFixed(1)}
              </span>
            )}
          </div>
        )
      },
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
    data: snapshots,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border bg-nb-900/60">
                {hg.headers.map((header) => (
                  <th key={header.id} className="px-4 py-2.5 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">
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
                  No markets match your filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-nb-900/30">
        <p className="text-xs text-nb-400">
          {snapshots.length} markets{!isPro && ' · Upgrade Pro for full access'}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
            Prev
          </Button>
          <span className="text-xs text-nb-400">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount() || 1}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs"
            onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
