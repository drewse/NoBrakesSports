import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface EmptyStateProps {
  icon?: React.ElementType
  title: string
  description?: string
  action?: {
    label: string
    href?: string
    onClick?: () => void
  }
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-nb-900">
          <Icon className="h-5 w-5 text-nb-400" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-nb-400 max-w-xs leading-relaxed mb-4">{description}</p>
      )}
      {action && (
        <>
          {action.href ? (
            <Button asChild size="sm" variant="outline">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
