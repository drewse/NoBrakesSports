'use client'

import { useState, useTransition } from 'react'
import { Loader2, MoreHorizontal, Pencil, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export type Pipeline = {
  id: string
  slug: string
  display_name: string
  source_type: string
  region: string
  is_enabled: boolean
  status: string
  priority: number
  ingestion_method: string | null
  health_status: string
  notes: string | null
  last_checked_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
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

// ── Full pipeline row (manages its own local state) ───────────────────────────

export function PipelineRow({ initial }: { initial: Pipeline }) {
  const [pipeline, setPipeline] = useState<Pipeline>(initial)

  const HEALTH_CLASSES: Record<string, string> = {
    unknown:  'text-nb-600',
    healthy:  'text-green-400',
    degraded: 'text-amber-400',
    down:     'text-red-400',
  }

  const REGION_LABELS: Record<string, string> = {
    us: 'US', ca: 'CA', us_ca: 'US/CA', ontario: 'Ontario', global: 'Global',
  }

  function fmt(ts: string | null) {
    if (!ts) return <span className="text-nb-700">—</span>
    return <span className="font-mono">{new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
  }

  return (
    <tr className="border-b border-border/40 hover:bg-nb-800/20 transition-colors">
      {/* Book */}
      <td className="px-4 py-3 min-w-[140px]">
        <p className="text-xs font-semibold text-white">{pipeline.display_name}</p>
        <p className="text-[10px] text-nb-600 font-mono">{pipeline.slug}</p>
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

      {/* Health */}
      <td className="px-4 py-3">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${HEALTH_CLASSES[pipeline.health_status] ?? 'text-nb-600'}`}>
          {pipeline.health_status}
        </span>
      </td>

      {/* Priority */}
      <td className="px-4 py-3">
        <PriorityCell pipeline={pipeline} onUpdate={setPipeline} />
      </td>

      {/* Ingestion method */}
      <td className="px-4 py-3">
        <span className="text-[10px] text-nb-600">{pipeline.ingestion_method ?? '—'}</span>
      </td>

      {/* Last checked */}
      <td className="px-4 py-3 text-[11px] text-nb-500">{fmt(pipeline.last_checked_at)}</td>

      {/* Last success */}
      <td className="px-4 py-3 text-[11px] text-nb-500">{fmt(pipeline.last_success_at)}</td>

      {/* Last error */}
      <td className="px-4 py-3 min-w-[120px]">
        {pipeline.last_error_at
          ? <div>
              <span className="text-[10px] text-red-400">{fmt(pipeline.last_error_at)}</span>
              {pipeline.last_error_message && (
                <p className="text-[9px] text-red-500/70 mt-0.5 max-w-[160px] truncate" title={pipeline.last_error_message}>
                  {pipeline.last_error_message}
                </p>
              )}
            </div>
          : <span className="text-nb-700">—</span>
        }
      </td>

      {/* Notes */}
      <td className="px-4 py-3 max-w-[220px]">
        <NotesCell pipeline={pipeline} onUpdate={setPipeline} />
      </td>
    </tr>
  )
}
