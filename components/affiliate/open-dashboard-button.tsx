'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Affiliate } from '@/lib/affiliate'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; affiliate: Affiliate | null; signedIn: boolean }

/**
 * "Already an affiliate?" button at the bottom of /affiliate.
 *
 * Behavior:
 *  - Logged-in + has code: routes to /affiliate/dashboard?id=<code>.
 *  - Logged-in + no code:  shows a hint to create a code first.
 *  - Logged-out:           routes to /login?next=/affiliate.
 */
export function OpenDashboardButton() {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/affiliate/me', { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 401) {
          setState({ kind: 'ready', affiliate: null, signedIn: false })
          return
        }
        const json = await res.json().catch(() => ({}))
        setState({
          kind: 'ready',
          affiliate: json?.affiliate ?? null,
          signedIn: true,
        })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'ready', affiliate: null, signedIn: false })
      })
    return () => { cancelled = true }
  }, [])

  if (state.kind === 'loading') {
    return (
      <Button variant="outline" size="lg" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </Button>
    )
  }

  const onClick = () => {
    if (!state.signedIn) {
      router.push('/login?next=/affiliate')
      return
    }
    if (!state.affiliate) {
      setHint('Create an affiliate code first using the card above.')
      return
    }
    router.push(`/affiliate/dashboard?id=${encodeURIComponent(state.affiliate.code)}`)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="outline" size="lg" onClick={onClick}>
        Open Affiliate Dashboard
        <ArrowRight className="h-4 w-4" />
      </Button>
      {hint && <p className="text-xs text-nb-500">{hint}</p>}
    </div>
  )
}
