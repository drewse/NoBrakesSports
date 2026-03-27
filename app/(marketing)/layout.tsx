import Link from 'next/link'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-nb-950 text-white">
      {/* Navbar */}
      <nav className="fixed top-0 z-50 w-full border-b border-border/50 bg-nb-950/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-6 flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-white">
              <Zap className="h-4 w-4 text-nb-950 fill-nb-950" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-white">NO BRAKES</span>
              <span className="ml-1 text-[10px] font-medium text-nb-400 tracking-widest uppercase">SPORTS</span>
            </div>
          </Link>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/#features" className="text-sm text-nb-400 hover:text-white transition-colors">
              Features
            </Link>
            <Link href="/pricing" className="text-sm text-nb-400 hover:text-white transition-colors">
              Pricing
            </Link>
            <Link href="/#faq" className="text-sm text-nb-400 hover:text-white transition-colors">
              FAQ
            </Link>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="pt-16">
        {children}
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-nb-950 mt-24">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-white">
                  <Zap className="h-3.5 w-3.5 text-nb-950 fill-nb-950" />
                </div>
                <span className="text-xs font-bold tracking-tight">NO BRAKES SPORTS</span>
              </div>
              <p className="text-xs text-nb-400 leading-relaxed">
                Premium sports market analytics and intelligence platform.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Product</p>
              <ul className="space-y-2">
                <li><Link href="/#features" className="text-xs text-nb-400 hover:text-white transition-colors">Features</Link></li>
                <li><Link href="/pricing" className="text-xs text-nb-400 hover:text-white transition-colors">Pricing</Link></li>
                <li><Link href="/signup" className="text-xs text-nb-400 hover:text-white transition-colors">Get Started</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Company</p>
              <ul className="space-y-2">
                <li><Link href="/terms" className="text-xs text-nb-400 hover:text-white transition-colors">Terms of Service</Link></li>
                <li><Link href="/privacy" className="text-xs text-nb-400 hover:text-white transition-colors">Privacy Policy</Link></li>
                <li><Link href="/disclaimer" className="text-xs text-nb-400 hover:text-white transition-colors">Disclaimer</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-white uppercase tracking-wider mb-3">Support</p>
              <ul className="space-y-2">
                <li><a href="mailto:support@nobrakes.sports" className="text-xs text-nb-400 hover:text-white transition-colors">support@nobrakes.sports</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-nb-400">
              &copy; {new Date().getFullYear()} No Brakes Sports. All rights reserved.
            </p>
            <p className="text-xs text-nb-500 max-w-md text-center sm:text-right">
              This platform provides sports market data and analytics for informational purposes only.
              Not financial or gambling advice. Data may be delayed.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
