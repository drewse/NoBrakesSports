'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Bell, LogOut, User, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

interface TopbarProps {
  profile: Profile | null
  title?: string
}

export function Topbar({ profile, title }: TopbarProps) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-nb-950 px-6">
      <div className="flex items-center gap-3">
        {title && (
          <h1 className="text-sm font-semibold text-white">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="text-nb-400 hover:text-white" aria-label="Search">
          <Search className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="icon" className="relative text-nb-400 hover:text-white" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-white" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-full">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-nb-700 text-xs font-semibold text-white uppercase">
                {profile?.full_name?.[0] ?? profile?.email?.[0] ?? '?'}
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium text-white">{profile?.full_name ?? 'User'}</p>
                <p className="text-xs text-nb-400 font-normal truncate">{profile?.email}</p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push('/account/profile')}>
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push('/account/billing')}>
              <CreditCard className="h-4 w-4" />
              Billing
              {profile?.subscription_tier === 'pro' && (
                <Badge variant="pro" className="ml-auto">PRO</Badge>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              disabled={signingOut}
              className="text-nb-300 focus:text-white"
            >
              <LogOut className="h-4 w-4" />
              {signingOut ? 'Signing out...' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
