import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Gauge, AlertTriangle } from 'lucide-react'

export const metadata = { title: 'Admin · Proxy Usage' }

// IPRoyal mobile plan is 2 GB/mo at $13.60. Alert visual kicks in at 80 %.
const MOBILE_MONTHLY_GB_BUDGET = 2

interface UsageRow {
  adapter_slug: string
  proxy_tier: string
  bytes: number | string   // bigint may come back as string
  scrape_ms: number | null
  ts: string
}

function toBytes(v: number | string): number {
  if (typeof v === 'number') return v
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function sumBytes(rows: UsageRow[]): number {
  return rows.reduce((s, r) => s + toBytes(r.bytes), 0)
}

function groupBy<T, K extends string>(rows: T[], key: (r: T) => K): Record<K, T[]> {
  return rows.reduce((acc, r) => {
    const k = key(r)
    ;(acc[k] ??= []).push(r)
    return acc
  }, {} as Record<K, T[]>)
}

export default async function ProxyUsagePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) redirect('/dashboard')

  const now = new Date()
  const since30d = new Date(now.getTime() - 30 * 86400_000).toISOString()

  const { data: raw } = await supabase
    .from('proxy_usage_log')
    .select('adapter_slug, proxy_tier, bytes, scrape_ms, ts')
    .gte('ts', since30d)
    .order('ts', { ascending: false })

  const rows: UsageRow[] = (raw ?? []) as any

  const nowMs = now.getTime()
  const in24h = rows.filter(r => nowMs - new Date(r.ts).getTime() < 86400_000)
  const in7d  = rows.filter(r => nowMs - new Date(r.ts).getTime() < 7 * 86400_000)
  const in30d = rows

  // Monthly = current calendar month for billing alignment
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const inMonth = rows.filter(r => new Date(r.ts) >= monthStart)
  const mobileMonthBytes = sumBytes(inMonth.filter(r => r.proxy_tier === 'mobile'))
  const mobileMonthGb = mobileMonthBytes / (1024 ** 3)
  const budgetPct = (mobileMonthGb / MOBILE_MONTHLY_GB_BUDGET) * 100

  // Per-adapter totals across 7d for ranking
  const byAdapter7d = Object.entries(groupBy(in7d, r => r.adapter_slug))
    .map(([slug, rs]) => ({
      slug,
      bytes: sumBytes(rs),
      scrapes: rs.length,
      tiers: Array.from(new Set(rs.map(r => r.proxy_tier))),
    }))
    .sort((a, b) => b.bytes - a.bytes)

  // Per-tier totals across 30d
  const byTier30d = Object.entries(groupBy(in30d, r => r.proxy_tier))
    .map(([tier, rs]) => ({ tier, bytes: sumBytes(rs), scrapes: rs.length }))
    .sort((a, b) => b.bytes - a.bytes)

  const overBudget = budgetPct >= 80

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 sm:space-y-6 max-w-[900px]">
      <div className="flex items-center gap-2">
        <Gauge className="h-5 w-5 text-nb-400" />
        <h1 className="text-lg font-bold text-white">Proxy Bandwidth</h1>
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2">
            Mobile proxy — this billing month
            {overBudget && <AlertTriangle className="h-4 w-4 text-nb-300" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold font-mono text-white">{mobileMonthGb.toFixed(2)} GB</span>
            <span className="text-sm text-nb-400">of {MOBILE_MONTHLY_GB_BUDGET} GB budget</span>
          </div>
          <div className="h-2 bg-nb-800/50 rounded overflow-hidden">
            <div
              className={`h-full ${overBudget ? 'bg-nb-400' : 'bg-nb-300'}`}
              style={{ width: `${Math.min(100, budgetPct).toFixed(1)}%` }}
            />
          </div>
          <p className="text-xs text-nb-400">
            {budgetPct.toFixed(1)}% used · measured client-side (will under-report vs. IPRoyal meter by ~5%)
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Last 24h',  bytes: sumBytes(in24h),  scrapes: in24h.length },
          { label: 'Last 7d',   bytes: sumBytes(in7d),   scrapes: in7d.length },
          { label: 'Last 30d',  bytes: sumBytes(in30d),  scrapes: in30d.length },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-[10px] text-nb-400 uppercase tracking-wider">{s.label}</p>
              <p className="text-xl font-bold text-white font-mono">{fmt(s.bytes)}</p>
              <p className="text-xs text-nb-400">{s.scrapes.toLocaleString()} scrapes</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle>By proxy tier · 30 days</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {byTier30d.length === 0 && (
              <div className="p-5 text-sm text-nb-400">No data yet — wait for the first scrape to complete.</div>
            )}
            {byTier30d.map((t) => (
              <div key={t.tier} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{t.tier}</Badge>
                  <span className="text-xs text-nb-400">{t.scrapes.toLocaleString()} scrapes</span>
                </div>
                <span className="text-sm font-mono text-white">{fmt(t.bytes)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border pb-4">
          <CardTitle>By adapter · 7 days</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border">
            {byAdapter7d.length === 0 && (
              <div className="p-5 text-sm text-nb-400">No data yet.</div>
            )}
            {byAdapter7d.map((a) => (
              <div key={a.slug} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{a.slug}</span>
                  {a.tiers.map(t => (
                    <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                  ))}
                  <span className="text-xs text-nb-400">{a.scrapes.toLocaleString()} scrapes</span>
                </div>
                <span className="text-sm font-mono text-white">{fmt(a.bytes)}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
