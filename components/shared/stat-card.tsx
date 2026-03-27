import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { StatCard } from '@/types'

interface StatCardProps extends StatCard {
  className?: string
}

export function StatCard({ label, value, change, change_label, trend, className }: StatCardProps) {
  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <CardContent className="p-5">
        <p className="text-xs font-medium text-nb-400 uppercase tracking-wider mb-2">{label}</p>
        <p className="text-2xl font-bold text-white font-mono tabular-nums">{value}</p>
        {(change !== undefined || change_label) && (
          <div className="flex items-center gap-1.5 mt-2">
            {trend === 'up' && <TrendingUp className="h-3 w-3 text-white" />}
            {trend === 'down' && <TrendingDown className="h-3 w-3 text-nb-300" />}
            {trend === 'flat' && <Minus className="h-3 w-3 text-nb-400" />}
            {change !== undefined && (
              <span className={cn(
                'text-xs font-medium font-mono',
                trend === 'up' && 'text-white',
                trend === 'down' && 'text-nb-300',
                trend === 'flat' && 'text-nb-400',
                !trend && 'text-nb-400'
              )}>
                {change > 0 ? '+' : ''}{change}%
              </span>
            )}
            {change_label && (
              <span className="text-xs text-nb-400">{change_label}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
