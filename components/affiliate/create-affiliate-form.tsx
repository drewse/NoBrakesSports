'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AFFILIATE_CODE_MIN,
  AFFILIATE_CODE_MAX,
  sanitizeAffiliateCode,
  validateAffiliateCode,
  type Affiliate,
} from '@/lib/affiliate'

type State =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'has-code'; affiliate: Affiliate }
  | { kind: 'create' }

/**
 * Inline form embedded into the "Affiliate Program" card on /affiliate.
 *
 * Renders one of four states:
 *  - loading: while we fetch /api/affiliate/me
 *  - anonymous: not logged in -> CTA links to /login?next=/affiliate
 *  - has-code: user already has an affiliate row -> show their code + dashboard link
 *  - create: input + submit button
 */
export function CreateAffiliateForm() {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/affiliate/me', { cache: 'no-store' })
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 401) {
          setState({ kind: 'anonymous' })
          return
        }
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          setState({ kind: 'create' })
          setError(json?.error ?? 'Failed to load affiliate status.')
          return
        }
        if (json.affiliate) {
          setState({ kind: 'has-code', affiliate: json.affiliate })
        } else {
          setState({ kind: 'create' })
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'create' })
      })
    return () => { cancelled = true }
  }, [])

  const onCodeChange = (v: string) => {
    const sanitized = sanitizeAffiliateCode(v)
    setCode(sanitized)
    if (error) setError(null)
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validationErr = validateAffiliateCode(code)
    if (validationErr) {
      setError(validationErr)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/affiliate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.error ?? 'Could not create affiliate code.')
        return
      }
      const affiliate: Affiliate = json.affiliate
      router.push(`/affiliate/dashboard?id=${encodeURIComponent(affiliate.code)}`)
    } finally {
      setSubmitting(false)
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-xs text-nb-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking affiliate status…
      </div>
    )
  }

  if (state.kind === 'anonymous') {
    return (
      <Button asChild size="lg" className="w-full">
        <Link href="/login?next=/affiliate">
          Sign in to create code
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    )
  }

  if (state.kind === 'has-code') {
    const a = state.affiliate
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-start gap-2.5">
          <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="text-white font-medium">Your code is live</p>
            <p className="text-nb-400 mt-0.5">
              <span className="font-mono text-emerald-300">{a.code}</span>
            </p>
          </div>
        </div>
        <Button asChild size="lg" className="w-full">
          <Link href={`/affiliate/dashboard?id=${encodeURIComponent(a.code)}`}>
            Open Affiliate Dashboard
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    )
  }

  // create
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div>
        <Input
          type="text"
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          placeholder="yourcode"
          autoComplete="off"
          autoCapitalize="none"
          inputMode="text"
          minLength={AFFILIATE_CODE_MIN}
          maxLength={AFFILIATE_CODE_MAX}
          aria-invalid={!!error}
          aria-describedby="affiliate-code-help"
          disabled={submitting}
        />
        <p id="affiliate-code-help" className="text-[11px] text-nb-500 mt-1.5">
          {AFFILIATE_CODE_MIN}–{AFFILIATE_CODE_MAX} chars · lowercase letters, numbers, <code className="font-mono">-</code>, <code className="font-mono">_</code>
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive mt-1.5">{error}</p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={submitting || !code}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? 'Creating…' : 'Create Affiliate Code'}
      </Button>
    </form>
  )
}
