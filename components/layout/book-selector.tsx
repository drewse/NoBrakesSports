'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Source {
  name: string
  slug: string
}

interface BookSelectorProps {
  sources: Source[]
  initialEnabled: string[] | null  // null = all enabled
  canadianSlugs?: string[]
}

/**
 * Topbar trigger: a plain button that navigates to /books. Selection UI
 * now lives on that page rather than a dropdown.
 */
export function BookSelector({ sources, initialEnabled }: BookSelectorProps) {
  const isAll = initialEnabled === null
  const count = initialEnabled?.length ?? sources.length
  const label = isAll ? 'All Books' : `${count} of ${sources.length} Books`

  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={`gap-1.5 h-9 sm:h-8 px-2.5 text-xs ${
        isAll ? 'text-nb-400 hover:text-white' : 'text-white bg-nb-800 hover:bg-nb-700'
      }`}
    >
      <Link href="/books" aria-label="Open books selector">
        <BookOpen className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden xs:inline">{label}</span>
        <span className="xs:hidden">{isAll ? 'Books' : String(count)}</span>
      </Link>
    </Button>
  )
}
