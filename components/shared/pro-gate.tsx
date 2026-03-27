import Link from 'next/link'
import { Lock, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ProGateProps {
  children: React.ReactNode
  isPro: boolean
  featureName?: string
  className?: string
  blur?: boolean
}

export function ProGate({ children, isPro, featureName, className, blur = true }: ProGateProps) {
  if (isPro) return <>{children}</>

  return (
    <div className={cn('relative', className)}>
      {/* Blurred content preview */}
      {blur && (
        <div className="pointer-events-none select-none" aria-hidden>
          <div className="blur-sm opacity-30">{children}</div>
        </div>
      )}

      {/* Overlay */}
      <div className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-nb-900/90 p-8 text-center',
        blur ? 'absolute inset-0' : 'py-16'
      )}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-nb-800">
          <Lock className="h-4 w-4 text-nb-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white mb-1">
            {featureName ? `${featureName} is a Pro feature` : 'Pro Feature'}
          </p>
          <p className="text-xs text-nb-400 max-w-xs leading-relaxed">
            Upgrade to Pro to unlock full access to market analytics, alerts, and historical data.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/account/billing">
            <Zap className="h-3.5 w-3.5" />
            Upgrade to Pro
          </Link>
        </Button>
      </div>
    </div>
  )
}
