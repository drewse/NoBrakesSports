import Link from 'next/link'
import { Zap } from 'lucide-react'  // used in footer logo
import { SiteHeader } from '@/components/marketing/site-header'

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-nb-950 text-white">
      <SiteHeader />

      {/* Content — pad-top matches the new 72px header */}
      <div className="pt-[72px]">
        {children}
      </div>

      {/* Footer — clean and minimal */}
      <footer className="border-t border-nb-800/40">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-8 sm:py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white">
                  <Zap className="h-3.5 w-3.5 text-nb-950 fill-nb-950" />
                </div>
                <span className="text-xs font-bold tracking-tight">NO BRAKES SPORTS</span>
              </div>
              <p className="text-xs text-nb-500 leading-relaxed">
                Sports market analytics for serious bettors.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-nb-300 uppercase tracking-wider mb-3">Product</p>
              <ul className="space-y-2">
                <li><Link href="/#features" className="text-xs text-nb-500 hover:text-white transition-colors">Features</Link></li>
                <li><Link href="/pricing" className="text-xs text-nb-500 hover:text-white transition-colors">Pricing</Link></li>
                <li><Link href="/signup" className="text-xs text-nb-500 hover:text-white transition-colors">Get Started</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-nb-300 uppercase tracking-wider mb-3">Legal</p>
              <ul className="space-y-2">
                <li><Link href="/terms" className="text-xs text-nb-500 hover:text-white transition-colors">Terms</Link></li>
                <li><Link href="/privacy" className="text-xs text-nb-500 hover:text-white transition-colors">Privacy</Link></li>
                <li><Link href="/disclaimer" className="text-xs text-nb-500 hover:text-white transition-colors">Disclaimer</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-nb-300 uppercase tracking-wider mb-3">Support</p>
              <ul className="space-y-2">
                <li><a href="mailto:support@nobrakes.sports" className="text-xs text-nb-500 hover:text-white transition-colors">support@nobrakes.sports</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-nb-800/40 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-nb-600">
              &copy; {new Date().getFullYear()} No Brakes Sports. All rights reserved.
            </p>
            <p className="text-xs text-nb-600 max-w-sm text-center sm:text-right">
              For informational purposes only. Not financial or gambling advice.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
