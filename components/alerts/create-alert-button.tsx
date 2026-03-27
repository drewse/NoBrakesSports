'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/hooks/use-toast'
import type { League, MarketSource } from '@/types'

const schema = z.object({
  name: z.string().min(1, 'Name required'),
  alert_type: z.enum(['line_movement', 'price_change', 'source_divergence', 'event_start']),
  threshold: z.string().optional(),
  league_id: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface Props { leagues: League[]; sources: MarketSource[]; userId: string }

export function CreateAlertButton({ leagues, userId }: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const { register, handleSubmit, watch, setValue, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { alert_type: 'line_movement' },
  })
  const alertType = watch('alert_type')

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    try {
      const supabase = createClient()
      const conditions: Record<string, unknown> = {}
      if (data.threshold) conditions.threshold = parseFloat(data.threshold)

      const { error } = await supabase.from('alerts').insert({
        user_id: userId,
        name: data.name,
        alert_type: data.alert_type,
        conditions,
        league_id: data.league_id || null,
        status: 'active',
        notification_channels: ['in_app'],
      })
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return }
      toast({ title: 'Alert created', description: 'Your alert is now active.' })
      setOpen(false)
      reset()
      router.refresh()
    } finally { setSaving(false) }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> New alert
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Alert</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Alert name</Label>
              <Input placeholder="e.g. Chiefs spread moves 2+ points" {...register('name')} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Alert type</Label>
              <Select value={alertType} onValueChange={(v) => setValue('alert_type', v as FormData['alert_type'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="line_movement">Line Movement</SelectItem>
                  <SelectItem value="price_change">Price Change</SelectItem>
                  <SelectItem value="source_divergence">Source Divergence</SelectItem>
                  <SelectItem value="event_start">Event Start Reminder</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {alertType !== 'event_start' && (
              <div className="space-y-1.5">
                <Label>
                  {alertType === 'source_divergence' ? 'Divergence threshold (%)' : 'Movement threshold (points)'}
                </Label>
                <Input type="number" step="0.5"
                  placeholder={alertType === 'source_divergence' ? '5' : '2.5'}
                  {...register('threshold')} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>League (optional)</Label>
              <Select onValueChange={(v) => setValue('league_id', v)}>
                <SelectTrigger><SelectValue placeholder="Any league" /></SelectTrigger>
                <SelectContent>
                  {leagues.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.abbreviation ?? l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? 'Creating...' : 'Create alert'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
