import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-nb-700 text-nb-100',
        outline: 'border-border text-nb-300',
        white: 'border-white/20 bg-white/10 text-white',
        pro: 'border-white/20 bg-white/10 text-white font-semibold uppercase tracking-wider text-[10px]',
        live: 'border-transparent bg-white text-nb-950 font-semibold uppercase tracking-wider text-[10px] animate-pulse',
        up: 'border-transparent bg-white/10 text-white',
        down: 'border-transparent bg-nb-700 text-nb-300',
        flat: 'border-border text-nb-400',
        muted: 'border-transparent bg-nb-800 text-nb-400',
        healthy: 'border-transparent bg-white/10 text-white',
        degraded: 'border-transparent bg-nb-600 text-nb-200',
        down_status: 'border-transparent bg-nb-700 text-nb-300',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
