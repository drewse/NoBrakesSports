import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

/**
 * Shared "Join the Discord" CTA. Originally lived inline on the
 * marketing community-proof section; extracted so the coaching page
 * (and any future page) can render the same Discord-branded button
 * without duplicating styling.
 *
 * Two sizes:
 *   • lg — landing-page hero button (default)
 *   • sm — sidebar / inline contexts (used in the coaching disclaimer)
 *
 * The href is centralized here so flipping the real invite URL is a
 * one-liner instead of grepping the codebase.
 */

// TODO: replace once the real invite is finalized.
export const DISCORD_INVITE_URL = '#'

export function DiscordIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.09.09 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.09 16.09 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09-.01-.02-.04-.03-.07-.03-1.5.26-2.93.71-4.27 1.33-.01 0-.02.01-.03.02-2.72 4.07-3.47 8.03-3.1 11.95 0 .02.01.04.03.05 1.8 1.32 3.53 2.12 5.24 2.65.03.01.06 0 .07-.02.4-.55.76-1.13 1.07-1.74.02-.04 0-.08-.04-.09-.57-.22-1.11-.48-1.64-.78-.04-.02-.04-.08-.01-.11.11-.08.22-.17.33-.25.02-.02.05-.02.07-.01 3.44 1.57 7.15 1.57 10.55 0 .02-.01.05-.01.07.01.11.09.22.17.33.26.04.03.04.09-.01.11-.52.31-1.07.56-1.64.78-.04.01-.05.06-.04.09.32.61.68 1.19 1.07 1.74.03.01.06.02.09.02 1.72-.53 3.45-1.33 5.25-2.65.02-.01.03-.03.03-.05.44-4.53-.73-8.46-3.1-11.95-.01-.01-.02-.02-.04-.02zM8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.84 2.12-1.89 2.12zm6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12 0 1.17-.83 2.12-1.89 2.12z" />
    </svg>
  )
}

export function DiscordButton({
  size = 'lg',
  label = 'Join the Discord',
  className = '',
}: {
  size?: 'lg' | 'sm'
  label?: string
  className?: string
}) {
  const sizeClasses = size === 'lg'
    ? 'h-12 px-6 text-sm shadow-[0_8px_30px_rgba(88,101,242,0.35)] hover:shadow-[0_8px_40px_rgba(88,101,242,0.5)]'
    : 'h-9 px-4 text-xs'
  return (
    <Link
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join the No Brakes Sports Discord community"
      className={[
        'inline-flex items-center gap-2 rounded-xl bg-[#5865F2] hover:bg-[#4752c4]',
        'font-semibold text-white transition-all hover:scale-[1.03] active:scale-[0.98]',
        sizeClasses,
        className,
      ].join(' ')}
    >
      <DiscordIcon className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
      {label}
      {size === 'lg' && <ArrowRight className="h-4 w-4 opacity-80" />}
    </Link>
  )
}
