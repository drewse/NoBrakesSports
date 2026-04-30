/**
 * Skeleton shown during /odds market-selection transitions
 * (NBA ML → NHL Player Shots, etc.). React unmounts the previous
 * data subtree the moment the URL search params change (we key the
 * Suspense by the selection in app/(app)/odds/page.tsx), and the
 * fallback below renders until the new server-side query resolves.
 *
 * Two variants because the table layout is different for game-line
 * markets (book columns × event rows) vs prop markets (book columns
 * × player rows nested under each game). Pick the right one based
 * on `kind`.
 */

import { Card, CardContent } from '@/components/ui/card'

interface OddsSkeletonProps {
  kind: 'game' | 'props'
}

export function OddsSkeleton({ kind }: OddsSkeletonProps) {
  return (
    <Card className="bg-nb-900/40 border-nb-800">
      <CardContent className="p-0">
        {/* Header row — book columns */}
        <div className="px-4 py-3 border-b border-nb-800 flex items-center gap-3">
          <div className="h-3 w-32 rounded bg-nb-800 shimmer" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-5 w-12 rounded bg-nb-800 shimmer" />
            ))}
          </div>
        </div>

        {kind === 'game' ? <GameRowsSkeleton /> : <PropsRowsSkeleton />}
      </CardContent>
    </Card>
  )
}

function GameRowsSkeleton() {
  // Event rows — left column = matchup + start time, right = book cells.
  return (
    <div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3 border-b border-border/40 flex items-center gap-3">
          <div className="space-y-1.5">
            <div className="h-4 w-44 rounded bg-nb-800 shimmer" />
            <div className="h-3 w-28 rounded bg-nb-800/60 shimmer" />
          </div>
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 8 }).map((_, j) => (
              <div key={j} className="space-y-1">
                <div className="h-4 w-14 rounded bg-nb-800 shimmer" />
                <div className="h-4 w-14 rounded bg-nb-800 shimmer" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PropsRowsSkeleton() {
  // Game group — title + ~5 player rows under each.
  return (
    <div>
      {Array.from({ length: 3 }).map((_, g) => (
        <div key={g} className="border-b border-border/40">
          {/* Game title */}
          <div className="px-4 py-2.5 bg-nb-900/60 flex items-center gap-3">
            <div className="h-4 w-56 rounded bg-nb-800 shimmer" />
            <div className="ml-auto h-3 w-24 rounded bg-nb-800/60 shimmer" />
          </div>
          {/* Player rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-2.5 border-t border-border/30 flex items-center gap-3">
              <div className="space-y-1.5">
                <div className="h-4 w-32 rounded bg-nb-800 shimmer" />
                <div className="h-3 w-16 rounded bg-nb-800/60 shimmer" />
              </div>
              <div className="ml-auto flex gap-2">
                {Array.from({ length: 8 }).map((_, j) => (
                  <div key={j} className="space-y-1">
                    <div className="h-4 w-14 rounded bg-nb-800 shimmer" />
                    <div className="h-4 w-14 rounded bg-nb-800 shimmer" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
