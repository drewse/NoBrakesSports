'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Zap } from 'lucide-react'

/**
 * Marketing-site sticky header. ~72px tall, dark glass background with a
 * hairline bottom border. Right side stays slim on mobile (only the CTA
 * is visible under sm); the rest of the nav unfolds at sm+.
 */
export function SiteHeader() {
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
            href="/login"
            className="hidden xs:inline-flex h-9 items-center px-3 text-sm text-nb-300 hover:text-white transition-colors rounded-md"
          >
            Log in
          </Link>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-nb-950 shadow-[0_0_24px_rgba(255,255,255,0.18)] hover:shadow-[0_0_32px_rgba(255,255,255,0.28)] transition-shadow"
            >
              Get started
            </Link>
          </motion.div>
        </nav>
      </div>
    </motion.header>
  )
}
