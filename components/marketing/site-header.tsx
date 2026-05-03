'use client'

import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface AuthedUser {
  avatarUrl: string | null
  initial: string
}

/**
 * Marketing-site sticky header. ~72px tall, dark glass background with a
 * hairline bottom border. Right side stays slim on mobile (only the CTA
 * is visible under sm); the rest of the nav unfolds at sm+.
 *
 * When the visitor is signed in, the right-side `Log in` / `Get started`
 * pair is replaced by `<avatar> Launch app` so returning users land back
 * in the product in one click instead of being prompted to sign up again.
 */
export function SiteHeader() {
  // null = not yet checked (render placeholder), false = anonymous
  const [user, setUser] = useState<AuthedUser | null | false>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    ;(async () => {
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!authUser) {
        setUser(false)
        return
      }
      // Pull avatar / name from profiles. Failing softly: still treat as
      // signed-in even if the profile row hasn't been created yet.
      const { data: profile } = await supabase
        .from('profiles')
        .select('avatar_url, full_name, username')
        .eq('id', authUser.id)
        .maybeSingle()
      if (cancelled) return
      const nameSource = (profile?.full_name as string | null)
        ?? (profile?.username as string | null)
        ?? authUser.email
        ?? '?'
      setUser({
        avatarUrl: (profile?.avatar_url as string | null) ?? null,
        initial: nameSource.charAt(0).toUpperCase(),
      })
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="fixed top-0 z-50 w-full border-b border-white/10 bg-black/60 backdrop-blur-xl"
    >
      <div className="mx-auto flex h-[72px] w-full max-w-[1440px] items-center justify-between px-6 sm:px-8 lg:px-12 xl:px-16">
        {/* Logo */}
        <Link href="/" className="group flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-[0_0_24px_rgba(255,255,255,0.18)] transition-transform group-hover:scale-105">
            <Zap className="h-4 w-4 text-nb-950 fill-nb-950" />
          </div>
          <span className="flex flex-col leading-none">
            <span className="text-sm font-bold tracking-tight text-white whitespace-nowrap">NO BRAKES</span>
            <span className="mt-0.5 text-[9px] font-medium tracking-[0.18em] text-nb-500">SPORTS</span>
          </span>
        </Link>

        {/* Right nav */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/#features"
            className="hidden sm:inline-flex h-9 items-center px-3 text-sm text-nb-300 hover:text-white transition-colors rounded-md"
          >
            Features
          </Link>
          <Link
            href="/pricing"
            className="hidden sm:inline-flex h-9 items-center px-3 text-sm text-nb-300 hover:text-white transition-colors rounded-md"
          >
            Pricing
          </Link>
          <Link
            href="/affiliate"
            className="inline-flex h-9 items-center px-2.5 sm:px-3 text-sm text-nb-300 hover:text-white transition-colors rounded-md"
          >
            Affiliates
          </Link>
          {/* Auth-aware right side. While `user` is null we render a
              fixed-width placeholder so the header doesn't reflow when
              the auth check finishes. */}
          {user === null ? (
            // Placeholder kept narrow on mobile so the right edge
            // doesn't shift when the auth check resolves.
            <div aria-hidden className="h-8 w-[112px] sm:h-9 sm:w-[152px]" />
          ) : user === false ? (
            <>
              <Link
                href="/login"
                className="hidden xs:inline-flex h-9 items-center px-3 text-sm text-nb-300 hover:text-white transition-colors rounded-md"
              >
                Log in
              </Link>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/signup"
                  // Smaller mobile footprint: h-8 / px-3 / text-xs at base,
                  // step up to h-9 / px-4 / text-sm at sm+. Rounded-lg
                  // (less aggressive than rounded-xl) reads better at the
                  // smaller size. whitespace-nowrap prevents the label
                  // from wrapping on very narrow viewports.
                  className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg sm:rounded-xl bg-white px-3 sm:px-4 text-xs sm:text-sm font-semibold text-nb-950 whitespace-nowrap shadow-[0_0_24px_rgba(255,255,255,0.18)] hover:shadow-[0_0_32px_rgba(255,255,255,0.28)] transition-shadow"
                >
                  Get started
                </Link>
              </motion.div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2.5">
              <Link
                href="/account/profile"
                className="flex h-7 w-7 sm:h-8 sm:w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-nb-800 text-xs font-semibold text-white hover:border-white/40 transition-colors"
                aria-label="Account"
              >
                {user.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{user.initial}</span>
                )}
              </Link>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
                <Link
                  href="/odds"
                  // Same shrink as Get started — fits cleanly in the
                  // header at 375px viewport width without wrapping.
                  className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg sm:rounded-xl bg-white px-3 sm:px-4 text-xs sm:text-sm font-semibold text-nb-950 whitespace-nowrap shadow-[0_0_24px_rgba(255,255,255,0.18)] hover:shadow-[0_0_32px_rgba(255,255,255,0.28)] transition-shadow"
                >
                  Launch app
                </Link>
              </motion.div>
            </div>
          )}
        </nav>
      </div>
    </motion.header>
  )
}
