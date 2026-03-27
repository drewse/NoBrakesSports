import Link from 'next/link'
import { Zap } from 'lucide-react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-nb-950 flex flex-col">
      {/* Header */}
      <header className="flex h-14 items-center px-6 border-b border-border">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-white">
            <Zap className="h-3.5 w-3.5 text-nb-950 fill-nb-950" />
          </div>
          <span className="text-sm font-bold tracking-tight text-white">NO BRAKES SPORTS</span>
        </Link>
      </header>

      {/* Main */}
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        {children}
      </main>

      {/* Footer */}
      <footer className="flex h-12 items-center justify-center border-t border-border">
        <p className="text-xs text-nb-500">
          For informational use only. Not financial or gambling advice.{' '}
          <Link href="/terms" className="hover:text-nb-300 transition-colors">Terms</Link>
          {' · '}
          <Link href="/privacy" className="hover:text-nb-300 transition-colors">Privacy</Link>
        </p>
      </footer>
    </div>
  )
}
