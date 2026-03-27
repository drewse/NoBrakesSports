'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BellOff, Trash2, Activity } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { formatRelativeTime } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import type { Alert } from '@/types'

const ALERT_TYPE_LABELS: Record<string, string> = {
  line_movement: 'Line Movement',
  price_change: 'Price Change',
  source_divergence: 'Divergence',
  event_start: 'Event Start',
}

export function AlertsList({ alerts }: { alerts: Alert[] }) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No alerts yet"
        description="Create an alert to get notified when market conditions match your criteria."
      />
    )
  }

  const toggleAlert = async (id: string, status: string) => {
    setLoading(id)
    const supabase = createClient()
    await supabase.from('alerts').update({ status: status === 'active' ? 'paused' : 'active' }).eq('id', id)
    router.refresh()
    setLoading(null)
  }

  const deleteAlert = async (id: string) => {
    setLoading(id)
    const supabase = createClient()
    await supabase.from('alerts').update({ status: 'deleted' }).eq('id', id)
    router.refresh()
    setLoading(null)
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <Card key={alert.id} className={alert.status === 'paused' ? 'opacity-60' : ''}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <p className="text-sm font-semibold text-white">{alert.name}</p>
                  <Badge variant={alert.status === 'active' ? 'white' : alert.status === 'triggered' ? 'live' : 'muted'} className="text-[10px]">
                    {alert.status}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
                  </Badge>
                </div>

                {alert.description && (
                  <p className="text-xs text-nb-400 mb-2">{alert.description}</p>
                )}

                <div className="flex flex-wrap gap-3 text-[10px] text-nb-500">
                  {(alert as any).league && (
                    <span>League: {(alert as any).league.abbreviation ?? (alert as any).league.name}</span>
                  )}
                  {(alert as any).event && (
                    <span>Event: {(alert as any).event.title}</span>
                  )}
                  {alert.trigger_count > 0 && (
                    <span className="flex items-center gap-1">
                      <Activity className="h-3 w-3" />
                      Triggered {alert.trigger_count}×
                      {alert.last_triggered_at && ` · ${formatRelativeTime(alert.last_triggered_at)}`}
                    </span>
                  )}
                  <span>Created {formatRelativeTime(alert.created_at)}</span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon-sm" disabled={loading === alert.id}
                  onClick={() => toggleAlert(alert.id, alert.status)}
                  title={alert.status === 'active' ? 'Pause' : 'Activate'}>
                  {alert.status === 'active'
                    ? <BellOff className="h-3.5 w-3.5 text-nb-400" />
                    : <Bell className="h-3.5 w-3.5 text-nb-400" />}
                </Button>
                <Button variant="ghost" size="icon-sm" disabled={loading === alert.id}
                  onClick={() => deleteAlert(alert.id)} title="Delete">
                  <Trash2 className="h-3.5 w-3.5 text-nb-400 hover:text-destructive transition-colors" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
