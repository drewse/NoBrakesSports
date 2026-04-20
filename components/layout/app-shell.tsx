'use client'

import { useState } from 'react'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import type { Profile } from '@/types'

interface AppShellProps {
  profile: Profile | null
  sources: { name: string; slug: string }[]
  initialEnabledBooks: string[] | null
  canadianSlugs: string[]
  children: React.ReactNode
}

export function AppShell({
  profile,
  sources,
  initialEnabledBooks,
  canadianSlugs,
  children,
}: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-nb-950">
      <Sidebar
        profile={profile}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar
          profile={profile}
          sources={sources}
          initialEnabledBooks={initialEnabledBooks}
          canadianSlugs={canadianSlugs}
          onMenuClick={() => setMobileNavOpen(true)}
        />
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
