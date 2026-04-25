'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard, BarChart3, LineChart,
  Bookmark, History, Settings, Shield, ChevronRight, Zap,
  Star, Percent, Users, MessageSquare, Tag, GitBranch, X, Plug
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { Profile } from '@/types'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: string
  isPro?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview',      href: '/dashboard',   icon: LayoutDashboard },
  { label: 'Markets',       href: '/markets',      icon: BarChart3 },
  { label: 'Odds',          href: '/odds',         icon: LineChart },
  { label: 'Top EV Lines',  href: '/top-lines',    icon: Star,           isPro: true },
  { label: 'Arbitrage',     href: '/arbitrage',    icon: Percent,        isPro: true },
  { label: 'Promotions',    href: '/promotions',   icon: Tag },
  { label: '1on1 Coaching', href: '/coaching',     icon: Users },
  { label: 'Chat',          href: '/chat',         icon: MessageSquare },
  { label: 'Watchlist',     href: '/watchlist',    icon: Bookmark },
  { label: 'History',       href: '/history',      icon: History,        isPro: true },
]

const BOTTOM_ITEMS: NavItem[] = [
  { label: 'Account', href: '/account', icon: Settings },
  { label: 'Admin', href: '/admin', icon: Shield },
]

interface SidebarProps {
  profile: Profile | null
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export function Sidebar({ profile, mobileOpen = false, onMobileClose }: SidebarProps) {
  const pathname = usePathname()
  const isPro = profile?.subscription_tier === 'pro' && profile?.subscription_status === 'active'
  const isAdmin = profile?.is_admin

  // Close drawer when navigating
  useEffect(() => {
    if (mobileOpen && onMobileClose) onMobileClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [mobileOpen])

  return (
    <>
      {/* Backdrop (mobile only) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-full w-[260px] flex-col border-r border-border bg-nb-950 transition-transform duration-200 ease-in-out',
          'lg:static lg:w-[220px] lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
        aria-label="Sidebar navigation"
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between gap-2.5 border-b border-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-white">
              <Zap className="h-4 w-4 text-nb-950 fill-nb-950" />
            </div>
            <div>
              <p className="text-sm font-bold tracking-tight text-white leading-none">NO BRAKES</p>
              <p className="text-[10px] font-medium text-nb-400 tracking-widest uppercase leading-none mt-0.5">SPORTS</p>
            </div>
          </div>
          <button
            onClick={onMobileClose}
            className="lg:hidden -mr-1 flex h-9 w-9 items-center justify-center rounded text-nb-400 hover:bg-nb-800 hover:text-white"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Main Nav */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} isPro={isPro} />
          ))}

          <div className="my-3 border-t border-border" />

          {BOTTOM_ITEMS.map((item) => {
            if (item.href === '/account') return <NavLink key={item.href} item={item} pathname={pathname} isPro={isPro} />
            if (!isAdmin) return null
            return <NavLink key={item.href} item={item} pathname={pathname} isPro={isPro} />
          })}

          {isAdmin && (
            <>
              <div className="mt-3 mb-1.5 px-2">
                <p className="text-[9px] font-semibold text-nb-700 uppercase tracking-widest">Internal</p>
              </div>
              <NavLink
                item={{ label: 'Data Pipelines', href: '/admin/data-pipelines', icon: GitBranch }}
                pathname={pathname}
                isPro={false}
              />
              <NavLink
                item={{ label: 'Adapters', href: '/admin/adapters', icon: Plug }}
                pathname={pathname}
                isPro={false}
              />
            </>
          )}
        </nav>

        {/* Upgrade CTA (free users) */}
        {!isPro && (
          <div className="m-3 rounded-lg border border-border bg-nb-900 p-3">
            <p className="text-xs font-semibold text-white mb-1">Upgrade to Pro</p>
            <p className="text-[11px] text-nb-400 mb-2 leading-relaxed">
              Real-time data, alerts, and full analytics.
            </p>
            <Link
              href="/account/billing"
              className="flex items-center justify-center gap-1 w-full rounded bg-white text-nb-950 text-xs font-semibold py-2 hover:bg-nb-100 transition-colors"
            >
              Upgrade <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        )}

        {/* User info */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-nb-700 text-xs font-semibold text-white uppercase shrink-0">
              {profile?.full_name?.[0] ?? profile?.email?.[0] ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white truncate">
                {profile?.full_name ?? 'User'}
              </p>
              <div className="flex items-center gap-1">
                {isPro ? (
                  <Badge variant="pro" className="text-[9px] py-0">PRO</Badge>
                ) : (
                  <span className="text-[11px] text-nb-400">Free</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

function NavLink({
  item,
  pathname,
  isPro,
}: {
  item: NavItem
  pathname: string
  isPro: boolean
}) {
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
  const isLocked = item.isPro && !isPro
  const Icon = item.icon

  return (
    <Link
      href={isLocked ? '/account/billing' : item.href}
      className={cn(
        'nav-link min-h-[40px]',
        isActive && 'active',
        isLocked && 'opacity-50'
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {isLocked && (
        <span className="text-[10px] text-nb-400 uppercase tracking-wider">Pro</span>
      )}
      {item.badge && (
        <Badge variant="muted" className="text-[10px] py-0">{item.badge}</Badge>
      )}
    </Link>
  )
}
