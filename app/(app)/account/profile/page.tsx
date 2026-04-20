'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/hooks/use-toast'
import { useEffect } from 'react'
import type { Profile } from '@/types'

export const dynamic = 'force-dynamic'

const schema = z.object({
  full_name: z.string().min(1, 'Name required'),
  username: z.string().min(2, 'Min 2 chars').optional().or(z.literal('')),
  bio: z.string().max(160).optional().or(z.literal('')),
})
type FormData = z.infer<typeof schema>

export default function ProfilePage() {
  const router = useRouter()
  const { toast } = useToast()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
      if (data) {
        setProfile(data as Profile)
        reset({ full_name: data.full_name ?? '', username: data.username ?? '', bio: data.bio ?? '' })
      }
    }
    load()
  }, [reset, router])

  const onSubmit = async (data: FormData) => {
    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { error } = await supabase.from('profiles').update({
        full_name: data.full_name,
        username: data.username || null,
        bio: data.bio || null,
      }).eq('id', user.id)
      if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return }
      toast({ title: 'Profile updated' })
      router.refresh()
    } finally { setSaving(false) }
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 max-w-[600px] space-y-6">
      <h1 className="text-lg font-bold text-white">Profile</h1>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle>Account Information</CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile?.email ?? ''} disabled className="opacity-60" />
              <p className="text-xs text-nb-500">Email cannot be changed</p>
            </div>

            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input placeholder="Alex Chen" {...register('full_name')} />
              {errors.full_name && <p className="text-xs text-destructive">{errors.full_name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input placeholder="alexchen" {...register('username')} />
              {errors.username && <p className="text-xs text-destructive">{errors.username.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Bio <span className="text-nb-500">(optional)</span></Label>
              <Input placeholder="Sports market researcher..." {...register('bio')} />
              {errors.bio && <p className="text-xs text-destructive">{errors.bio.message}</p>}
            </div>

            <Button type="submit" disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
