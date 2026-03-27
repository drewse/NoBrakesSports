'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Flag } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/lib/hooks/use-toast'
import type { FeatureFlag } from '@/types'

export default function FeatureFlagsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [flags, setFlags] = useState<FeatureFlag[]>([])
  const [loading, setLoading] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
      if (!profile?.is_admin) { router.push('/dashboard'); return }
      const { data } = await supabase.from('feature_flags').select('*').order('name')
      setFlags((data as FeatureFlag[]) ?? [])
    }
    load()
  }, [router])

  const toggle = async (flag: FeatureFlag) => {
    setLoading(flag.id)
    const supabase = createClient()
    const { error } = await supabase
      .from('feature_flags')
      .update({ is_enabled: !flag.is_enabled })
      .eq('id', flag.id)
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }) }
    else {
      setFlags((prev) => prev.map((f) => f.id === flag.id ? { ...f, is_enabled: !f.is_enabled } : f))
      toast({ title: `Flag ${!flag.is_enabled ? 'enabled' : 'disabled'}` })
    }
    setLoading(null)
  }

  return (
    <div className="p-6 space-y-6 max-w-[800px]">
      <div className="flex items-center gap-2">
        <Flag className="h-5 w-5 text-nb-400" />
        <h1 className="text-lg font-bold text-white">Feature Flags</h1>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {flags.map((flag) => (
              <div key={flag.id} className="flex items-center justify-between px-5 py-4 hover:bg-nb-800/20 transition-colors">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-white">{flag.name}</p>
                    <code className="text-[10px] text-nb-400 bg-nb-800 px-1.5 py-0.5 rounded">{flag.key}</code>
                  </div>
                  {flag.description && <p className="text-xs text-nb-400">{flag.description}</p>}
                  {flag.enabled_for_tiers?.length > 0 && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-[10px] text-nb-500">Enabled for:</span>
                      {flag.enabled_for_tiers.map((t) => (
                        <Badge key={t} variant="muted" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => toggle(flag)}
                  disabled={loading === flag.id}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${flag.is_enabled ? 'bg-white' : 'bg-nb-700'}`}
                >
                  <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-nb-950 transition-transform ${flag.is_enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                </button>
              </div>
            ))}
            {flags.length === 0 && (
              <div className="px-5 py-12 text-center text-sm text-nb-400">No feature flags configured</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
