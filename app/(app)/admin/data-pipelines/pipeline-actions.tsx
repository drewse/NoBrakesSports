'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, Pencil, Check, X, Play, CheckCircle2, AlertCircle, Zap, ExternalLink, ArrowRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export type Pipeline = {
  id: string
  slug: string
  display_name: string
  source_type: string
  region: string
  is_enabled: boolean
  is_running: boolean
  locked_at: string | null
  last_heartbeat_at: string | null
  status: string
  priority: number
  ingestion_method: string | null
  health_status: string
  notes: string | null
  last_checked_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  consecutive_failures: number
  circuit_open_at: string | null
  created_at: string
  updated_at: string
}

// ── Data source platform map ──────────────────────────────────────────────────
// Maps pipeline slugs to their underlying platform for display badges.
const KAMBI_SLUGS = new Set([
  'betrivers', 'unibet', 'leovegas', '888sport', 'betvictor', 'casumo',
])
const DIRECT_API_SLUGS: Record<string, string> = {
  pinnacle: 'Pinnacle API',
  pointsbet_on: 'PointsBet API',
  draftkings: 'DK API',
  fanduel: 'FD API',
  bet365: 'bet365 API',
  betway: 'Entain CDS',
  sports_interaction: 'Entain CDS',
  betmgm: 'Roar Digital',
  caesars: 'Caesars API',
  thescore: 'Penn API',
  bet99: 'Amelco WS',
}

// ── Toggle enable/disable ────────────────────────────────────────────────────

export function EnableToggle({ pipeline, onUpdate }: { pipeline: Pipeline; onUpdate: (p: Pipeline) => void }) {
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(async () => {
      const supabase = createClient()
      const next = !pipeline.is_enabled
      const { error } = await supabase
        .from('data_pipelines')
        .update({ is_enabled: next, updated_at: new Date().toISOString() })
        .eq('id', pipeline.id)
      if (!error) onUpdate({ ...pipeline, is_enabled: next })
    })
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      title={pipeline.is_enabled ? 'Disable pipeline' : 'Enable pipeline'}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        pipeline.is_enabled ? 'bg-white' : 'bg-nb-700'
      }`}
    >
      {isPending
        ? <Loader2 className="h-3 w-3 animate-spin mx-auto text-nb-400" />
        : <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-nb-950 transition-transform ${pipeline.is_enabled ? 'translate-x-4' : 'translate-x-1'}`} />
      }
    </button>
  )
}

// ── Inline notes editor ───────────────────────────────────────────────────────

export function NotesCell({ pipeline, onUpdate }: { pipeline: Pipeline; onUpdate: (p: Pipeline) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(pipeline.notes ?? '')
  const [isPending, startTransition] = useTransition()

  function save() {
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from('data_pipelines')
        .update({ notes: draft || null, updated_at: new Date().toISOString() })
        .eq('id', pipeline.id)
      if (!error) {
        onUpdate({ ...pipeline, notes: draft || null })
        setEditing(false)
      }
    })
  }

  function cancel() {
    setDraft(pipeline.notes ?? '')
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-start gap-1.5">
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={2}
          className="flex-1 rounded bg-nb-800 border border-nb-600 text-white text-[11px] px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-nb-400 min-w-[180px]"
        />
        <div className="flex flex-col gap-1 pt-0.5">
          <button onClick={save} disabled={isPending} className="p-1 rounded hover:bg-nb-700 text-green-400">
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          </button>
          <button onClick={cancel} className="p-1 rounded hover:bg-nb-700 text-nb-400">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-start gap-1.5 cursor-pointer" onClick={() => setEditing(true)}>
      <span className="text-[11px] text-nb-500 leading-relaxed">
        {pipeline.notes ?? <span className="italic text-nb-700">—</span>}
      </span>
      <Pencil className="h-2.5 w-2.5 text-nb-700 group-hover:text-nb-400 shrink-0 mt-0.5 transition-colors" />
    </div>
  )
}

// ── Status selector ───────────────────────────────────────────────────────────

const STATUS_OPTIONS = ['planned', 'inactive', 'healthy', 'warning', 'error'] as const
type Status = typeof STATUS_OPTIONS[number]

const STATUS_CLASSES: Record<Status, string> = {
  planned:  'bg-nb-800 text-nb-400 border-nb-700',
  inactive: 'bg-nb-800 text-nb-500 border-nb-700',
  healthy:  'bg-green-500/15 text-green-400 border-green-500/30',
  warning:  'bg-amber-500/15 text-amber-400 border-amber-500/30',
  error:    'bg-red-500/15 text-red-400 border-red-500/30',
}

export function StatusBadge({ pipeline, onUpdate }: { pipeline: Pipeline; onUpdate: (p: Pipeline) => void }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function set(status: Status) {
    setOpen(false)
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from('data_pipelines')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', pipeline.id)
      if (!error) onUpdate({ ...pipeline, status })
    })
  }

  const current = pipeline.status as Status

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isPending}
        className={`text-[10px] font-semibold px-2 py-0.5 rounded border capitalize ${STATUS_CLASSES[current]} hover:opacity-80 transition-opacity`}
      >
        {isPending ? '…' : pipeline.status}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-28 rounded-lg border border-border bg-nb-900 shadow-xl py-1">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => set(s)}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-semibold capitalize hover:bg-nb-800 transition-colors ${STATUS_CLASSES[s]} bg-transparent border-none`}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Priority editor ───────────────────────────────────────────────────────────

export function PriorityCell({ pipeline, onUpdate }: { pipeline: Pipeline; onUpdate: (p: Pipeline) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(pipeline.priority))
  const [isPending, startTransition] = useTransition()

  function save() {
    const val = parseInt(draft, 10)
    if (isNaN(val) || val < 1 || val > 100) { setEditing(false); setDraft(String(pipeline.priority)); return }
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from('data_pipelines')
        .update({ priority: val, updated_at: new Date().toISOString() })
        .eq('id', pipeline.id)
      if (!error) { onUpdate({ ...pipeline, priority: val }); setEditing(false) }
    })
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={1} max={100}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setDraft(String(pipeline.priority)) }}}
        className="w-12 rounded bg-nb-800 border border-nb-600 text-white text-xs px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-nb-400"
      />
    )
  }

  return (
    <button onClick={() => setEditing(true)} className="text-xs font-mono text-nb-300 hover:text-white transition-colors">
      {pipeline.priority}
    </button>
  )
}

// ── Run pipeline button ───────────────────────────────────────────────────────

type RunState = 'idle' | 'running' | 'success' | 'error'

export function RunPipelineButton({ slug, dbIsRunning }: { slug: string; dbIsRunning: boolean }) {
  const [state, setState] = useState<RunState>('idle')
  const [result, setResult] = useState<{ eventsUpserted?: number; snapshotsInserted?: number; errors?: string[] } | null>(null)

  const effectivelyRunning = dbIsRunning || state === 'running'

  async function run() {
    if (effectivelyRunning) return
    setState('running')
    setResult(null)
    try {
      const res = await fetch('/api/pipelines/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      })
      const data = await res.json()
      if (!res.ok) {
        setState('error')
        setResult({ errors: [data.error ?? `HTTP ${res.status}`] })
      } else {
        setState('success')
        setResult(data)
        setTimeout(() => { setState('idle'); setResult(null) }, 8000)
      }
    } catch (e: any) {
      setState('error')
      setResult({ errors: [e.message] })
    }
  }

  if (effectivelyRunning) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-nb-400">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span>Running…</span>
      </div>
    )
  }

  if (state === 'success' && result) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-green-400">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        <span className="whitespace-nowrap">
          {result.eventsUpserted ?? 0}e / {result.snapshotsInserted ?? 0}s
          {result.errors && result.errors.length > 0 && (
            <span className="text-amber-400 ml-1">({result.errors.length} err)</span>
          )}
        </span>
      </div>
    )
  }

  if (state === 'error' && result) {
    return (
      <div className="flex items-center gap-1 text-[10px] text-red-400" title={result.errors?.[0]}>
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span className="max-w-[120px] truncate">{result.errors?.[0] ?? 'Error'}</span>
      </div>
    )
  }

  return (
    <button
      onClick={run}
      title={`Run ${slug} pipeline now`}
      className="flex items-center gap-1 text-[10px] font-medium text-nb-400 hover:text-white border border-nb-700 hover:border-nb-500 rounded px-2 py-0.5 transition-colors"
    >
      <Play className="h-2.5 w-2.5" />
      Run
    </button>
  )
}

// ── Circuit breaker badge ─────────────────────────────────────────────────────

export function CircuitBreakerBadge({ pipeline, onUpdate }: { pipeline: Pipeline; onUpdate: (p: Pipeline) => void }) {
  const [isPending, startTransition] = useTransition()

  const CIRCUIT_OPEN_MS = 60 * 60 * 1000
  const isOpen = pipeline.circuit_open_at
    ? (Date.now() - new Date(pipeline.circuit_open_at).getTime()) < CIRCUIT_OPEN_MS
    : false

  const minutesLeft = pipeline.circuit_open_at && isOpen
    ? Math.ceil((CIRCUIT_OPEN_MS - (Date.now() - new Date(pipeline.circuit_open_at).getTime())) / 60_000)
    : 0

  function reset() {
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from('data_pipelines')
        .update({ circuit_open_at: null, consecutive_failures: 0, updated_at: new Date().toISOString() })
        .eq('id', pipeline.id)
      if (!error) onUpdate({ ...pipeline, circuit_open_at: null, consecutive_failures: 0 })
    })
  }

  if (isOpen) {
    return (
      <button
        onClick={reset}
        disabled={isPending}
        title={`Circuit tripped — resets in ${minutesLeft}m. Click to reset manually.`}
        className="flex items-center gap-1 text-[10px] text-orange-400 border border-orange-500/30 bg-orange-500/10 rounded px-1.5 py-0.5 hover:bg-orange-500/20 transition-colors"
      >
        {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Zap className="h-2.5 w-2.5" />}
        <span>circuit open {minutesLeft}m</span>
      </button>
    )
  }

  if (pipeline.consecutive_failures > 0) {
    return (
      <span className="text-[10px] text-amber-500" title={`${pipeline.consecutive_failures} consecutive failures`}>
        {pipeline.consecutive_failures} fail{pipeline.consecutive_failures > 1 ? 's' : ''}
      </span>
    )
  }

  return null
}

// ── Error log modal ───────────────────────────────────────────────────────────

function ErrorModal({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" />

      {/* Panel */}
      <div
        className="relative z-10 w-full max-w-lg rounded-xl border border-nb-700 bg-nb-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-nb-800 px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-white">{pipeline.display_name}</p>
            <p className="text-[10px] text-nb-500 font-mono">{pipeline.slug}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-nb-800 text-nb-400 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error detail */}
        <div className="px-5 py-4 space-y-3">
          {pipeline.last_error_at && (
            <div className="flex items-center gap-2 text-[10px] text-nb-500">
              <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
              <span>Last error at</span>
              <span className="font-mono text-red-400">
                {new Date(pipeline.last_error_at).toLocaleString('en-US', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })}
              </span>
            </div>
          )}

          {pipeline.last_error_message ? (
            <div className="rounded-lg bg-nb-950 border border-red-500/20 p-3">
              <p className="text-[11px] font-mono text-red-300 leading-relaxed whitespace-pre-wrap break-words">
                {pipeline.last_error_message}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-nb-600 italic">No error message recorded.</p>
          )}

          {pipeline.consecutive_failures > 0 && (
            <p className="text-[10px] text-amber-500">
              {pipeline.consecutive_failures} consecutive failure{pipeline.consecutive_failures > 1 ? 's' : ''}
              {pipeline.circuit_open_at ? ' — circuit is open' : ''}
            </p>
          )}
        </div>

        <div className="border-t border-nb-800 px-5 py-3 flex justify-end">
          <button
            onClick={onClose}
            className="text-[11px] text-nb-400 hover:text-white border border-nb-700 hover:border-nb-500 rounded px-3 py-1 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Full pipeline row (manages its own local state) ───────────────────────────

export function PipelineRow({ initial, stats }: { initial: Pipeline; stats?: { events: number; markets: number } }) {
  const [pipeline, setPipeline] = useState<Pipeline>(initial)
  const [showErrorModal, setShowErrorModal] = useState(false)

  const isKambi = KAMBI_SLUGS.has(pipeline.slug)
  const directApi = DIRECT_API_SLUGS[pipeline.slug]
  const hasAdapter = pipeline.ingestion_method != null

  const REGION_LABELS: Record<string, string> = {
    us: 'US', ca: 'CA', us_ca: 'US/CA', ontario: 'Ontario', global: 'Global',
  }

  function fmt(ts: string | null) {
    if (!ts) return <span className="text-nb-700">—</span>
    return <span className="font-mono">{new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
  }

  return (
    <>
      {showErrorModal && (
        <ErrorModal pipeline={pipeline} onClose={() => setShowErrorModal(false)} />
      )}

      <tr className={`border-b border-border/40 hover:bg-nb-800/20 transition-colors ${isKambi ? 'border-l-2 border-l-violet-500/30' : directApi ? 'border-l-2 border-l-sky-500/30' : ''}`}>

        {/* Book / Source */}
        <td className="px-4 py-3 min-w-[160px]">
          <Link href={`/admin/data-pipelines/${pipeline.slug}`} className="group inline-flex items-center gap-1.5">
            <p className="text-xs font-semibold text-white group-hover:text-nb-300 transition-colors">{pipeline.display_name}</p>
            <ArrowRight className="h-3 w-3 text-nb-700 group-hover:text-nb-400 transition-colors shrink-0" />
          </Link>
          <p className="text-[10px] text-nb-600 font-mono">{pipeline.slug}</p>
          {/* Data source badges */}
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {isKambi && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 uppercase tracking-wide">
                Kambi
              </span>
            )}
            {directApi && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 uppercase tracking-wide">
                {directApi}
              </span>
            )}
            {hasAdapter && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20 uppercase tracking-wide">
                Live
              </span>
            )}
          </div>
        </td>

        {/* Region */}
        <td className="px-4 py-3">
          <span className="text-[10px] text-nb-400">{REGION_LABELS[pipeline.region] ?? pipeline.region}</span>
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <StatusBadge pipeline={pipeline} onUpdate={setPipeline} />
        </td>

        {/* Enabled toggle */}
        <td className="px-4 py-3">
          <EnableToggle pipeline={pipeline} onUpdate={setPipeline} />
        </td>

        {/* Events count */}
        <td className="px-4 py-3 text-center">
          {(stats?.events ?? 0) > 0 ? (
            <span className="font-mono text-xs text-green-400 font-semibold">{stats?.events}</span>
          ) : (
            <span className="font-mono text-xs text-nb-700">0</span>
          )}
        </td>

        {/* Markets count */}
        <td className="px-4 py-3 text-center">
          {(stats?.markets ?? 0) > 0 ? (
            <span className="font-mono text-xs text-nb-300">{stats?.markets.toLocaleString()}</span>
          ) : (
            <span className="font-mono text-xs text-nb-700">0</span>
          )}
        </td>

        {/* Priority */}
        <td className="px-4 py-3">
          <PriorityCell pipeline={pipeline} onUpdate={setPipeline} />
        </td>

        {/* Ingestion method */}
        <td className="px-4 py-3">
          <div className="flex flex-col gap-0.5">
            {pipeline.ingestion_method
              ? <span className="text-[10px] text-nb-400">{pipeline.ingestion_method}</span>
              : <span className="text-[10px] text-nb-700">—</span>
            }
          </div>
        </td>

        {/* Last checked */}
        <td className="px-4 py-3 text-[11px] text-nb-500">{fmt(pipeline.last_checked_at)}</td>

        {/* Last success */}
        <td className="px-4 py-3 text-[11px] text-nb-500">{fmt(pipeline.last_success_at)}</td>

        {/* Last error — only show if last error is more recent than last success */}
        <td className="px-4 py-3 min-w-[140px]">
          <div className="flex flex-col gap-1">
            {pipeline.last_error_at && (!pipeline.last_success_at || pipeline.last_error_at > pipeline.last_success_at) ? (
              <button
                onClick={() => setShowErrorModal(true)}
                className="group text-left"
                title="Click to view full error"
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-red-400">{fmt(pipeline.last_error_at)}</span>
                  <ExternalLink className="h-2.5 w-2.5 text-red-500/40 group-hover:text-red-400 transition-colors" />
                </div>
                {pipeline.last_error_message && (
                  <p className="text-[9px] text-red-500/70 mt-0.5 max-w-[160px] truncate group-hover:text-red-400/80 transition-colors">
                    {pipeline.last_error_message}
                  </p>
                )}
              </button>
            ) : (
              <span className="text-nb-700">—</span>
            )}
            <CircuitBreakerBadge pipeline={pipeline} onUpdate={setPipeline} />
          </div>
        </td>

        {/* Notes */}
        <td className="px-4 py-3 max-w-[220px]">
          <NotesCell pipeline={pipeline} onUpdate={setPipeline} />
        </td>

        {/* Run */}
        <td className="px-4 py-3">
          <RunPipelineButton slug={pipeline.slug} dbIsRunning={pipeline.is_running} />
        </td>
      </tr>
    </>
  )
}
