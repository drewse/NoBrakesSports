'use client'

import { useMemo, useState, useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Search, Calendar as CalendarIcon, CheckCircle2, Clock, XCircle, RefreshCw, MessageSquare,
} from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled'

export interface AdminBooking {
  id: string
  userId: string
  userName: string
  userEmail: string
  userPlan: 'pro' | 'free'
  discordUsername: string | null
  scheduledAt: string
  durationMinutes: number
  status: BookingStatus
  topic: string | null
  userNotes: string | null
  adminNotes: string | null
  createdAt: string
}

type StatusFilter = 'upcoming' | 'all' | BookingStatus

const TOPIC_LABELS: Record<string, string> = {
  intro_bonus: 'Intro Bonus Walkthrough',
  reload_promos: 'Reload Promotions',
  odds_boosts: 'Odds & Profit Boosts',
  risk_free: 'Risk-Free Bet Strategy',
  refer_a_friend: 'Referral Programs',
  general: 'General Strategy',
}

export function CoachingBookingsClient({ initial }: { initial: AdminBooking[] }) {
  const [bookings, setBookings] = useState<AdminBooking[]>(initial)
  const [filter, setFilter] = useState<StatusFilter>('upcoming')
  const [search, setSearch] = useState('')
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null)
  const [adminNotesDraft, setAdminNotesDraft] = useState('')
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const visibleBookings = useMemo(() => {
    const now = new Date().toISOString()
    const q = search.trim().toLowerCase()
    let list = bookings.slice()
    if (filter === 'upcoming') {
      // Pending or confirmed in the future
      list = list.filter(b =>
        (b.status === 'pending' || b.status === 'confirmed') &&
        b.scheduledAt >= now,
      )
    } else if (filter !== 'all') {
      list = list.filter(b => b.status === filter)
    }
    if (q) {
      list = list.filter(b =>
        b.userName.toLowerCase().includes(q) ||
        b.userEmail.toLowerCase().includes(q) ||
        (b.discordUsername ?? '').toLowerCase().includes(q) ||
        (b.topic ?? '').toLowerCase().includes(q),
      )
    }
    // Default sort: upcoming-ascending. For all/cancelled/completed,
    // newest-first by created_at since past bookings sorted by
    // scheduled_at puts the oldest at the top which isn't useful.
    if (filter === 'upcoming' || filter === 'pending' || filter === 'confirmed') {
      list.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    } else {
      list.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))
    }
    return list
  }, [bookings, filter, search])

  const counts = useMemo(() => {
    const now = new Date().toISOString()
    return {
      upcoming: bookings.filter(b => (b.status === 'pending' || b.status === 'confirmed') && b.scheduledAt >= now).length,
      pending: bookings.filter(b => b.status === 'pending').length,
      confirmed: bookings.filter(b => b.status === 'confirmed').length,
      completed: bookings.filter(b => b.status === 'completed').length,
      cancelled: bookings.filter(b => b.status === 'cancelled').length,
      all: bookings.length,
    }
  }, [bookings])

  async function setStatus(id: string, status: BookingStatus, adminNotes?: string) {
    setPendingActionId(id)
    // Optimistic
    setBookings(prev => prev.map(b =>
      b.id === id ? { ...b, status, adminNotes: adminNotes ?? b.adminNotes } : b,
    ))
    try {
      const res = await fetch(`/api/admin/coaching-bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, admin_notes: adminNotes }),
      })
      if (!res.ok) throw new Error(`status update failed (${res.status})`)
    } catch {
      // Roll back on failure — refresh from server.
      window.location.reload()
    } finally {
      setPendingActionId(null)
    }
  }

  async function saveAdminNotes(id: string) {
    const value = adminNotesDraft.trim() || null
    setBookings(prev => prev.map(b =>
      b.id === id ? { ...b, adminNotes: value } : b,
    ))
    setEditingNotesId(null)
    startTransition(async () => {
      await fetch(`/api/admin/coaching-bookings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notes: value }),
      }).catch(() => { /* will refresh on next load */ })
    })
  }

  return (
    <div className="p-3 sm:p-4 lg:p-6 space-y-4 max-w-[1300px]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            Coaching Bookings
            <Badge variant="white" className="text-[10px]">ADMIN</Badge>
          </h1>
          <p className="text-xs text-nb-400 mt-0.5">
            Manage 1-on-1 method coaching sessions · {counts.upcoming} upcoming · {counts.pending} pending
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-nb-800 text-[11px] text-nb-300 hover:border-nb-600 hover:text-white"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Filter pills + search */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['upcoming',   'Upcoming',  counts.upcoming],
            ['pending',    'Pending',   counts.pending],
            ['confirmed',  'Confirmed', counts.confirmed],
            ['completed',  'Completed', counts.completed],
            ['cancelled',  'Cancelled', counts.cancelled],
            ['all',        'All',       counts.all],
          ] as const).map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                filter === key
                  ? 'bg-white text-nb-950 border-white'
                  : 'bg-transparent text-nb-400 border-nb-800 hover:border-nb-600 hover:text-white'
              }`}
            >
              {label} <span className="ml-1 opacity-60">{n}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-nb-500" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, discord…"
            className="w-full h-8 pl-8 pr-3 rounded-md bg-nb-900 border border-nb-800 text-xs text-white placeholder-nb-600 focus:outline-none focus:border-nb-600"
          />
        </div>
      </div>

      {/* List */}
      {visibleBookings.length === 0 ? (
        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="px-6 py-16 flex flex-col items-center justify-center text-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-nb-800 border border-nb-700">
              <CalendarIcon className="h-5 w-5 text-nb-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white mb-1">No bookings match</p>
              <p className="text-xs text-nb-500 max-w-xs">
                {search || filter !== 'all'
                  ? 'No bookings match your filters.'
                  : 'Booked sessions will appear here.'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-nb-900 border-nb-800">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-nb-950/60">
                  <tr className="border-b border-nb-800">
                    {['Session', 'User', 'Discord', 'Topic', 'Status', 'Actions', 'Notes'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-nb-400 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleBookings.map(b => {
                    const when = new Date(b.scheduledAt)
                    const isUpcoming = when.toISOString() >= new Date().toISOString()
                    const isPending = pendingActionId === b.id
                    return (
                      <tr key={b.id} className={`border-b border-border/30 hover:bg-nb-800/20 ${
                        b.status === 'pending' && isUpcoming ? 'border-l-2 border-l-amber-500/50' :
                        b.status === 'confirmed' ? 'border-l-2 border-l-green-500/40' :
                        b.status === 'cancelled' ? 'border-l-2 border-l-red-500/40 opacity-60' : ''
                      }`}>
                        <td className="px-3 py-2.5 align-top">
                          <p className="text-xs font-semibold text-white">
                            {when.toLocaleString('en-US', {
                              weekday: 'short', month: 'short', day: 'numeric',
                            })}
                          </p>
                          <p className="text-[10px] text-nb-400 font-mono">
                            {when.toLocaleString('en-US', {
                              hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
                            })}
                          </p>
                          <p className="text-[9px] text-nb-600 mt-0.5">{b.durationMinutes}m</p>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold text-white">{b.userName}</p>
                            {b.userPlan === 'pro' && <Badge variant="pro" className="text-[8px] px-1 py-0">PRO</Badge>}
                          </div>
                          <p className="text-[10px] text-nb-500 font-mono truncate max-w-[200px]">{b.userEmail}</p>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          {b.discordUsername ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#a5b4fc]">
                              {b.discordUsername}
                            </span>
                          ) : (
                            <span className="text-[10px] text-nb-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <p className="text-[11px] text-nb-200">
                            {b.topic ? (TOPIC_LABELS[b.topic] ?? b.topic) : '—'}
                          </p>
                          {b.userNotes && (
                            <p className="text-[10px] text-nb-500 mt-1 max-w-[280px] line-clamp-3 leading-snug">
                              {b.userNotes}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <StatusBadge status={b.status} />
                          <p className="text-[9px] text-nb-600 mt-1">{formatRelativeTime(b.createdAt)}</p>
                        </td>
                        <td className="px-3 py-2.5 align-top">
                          <div className="flex flex-col gap-1">
                            {b.status === 'pending' && (
                              <button
                                disabled={isPending}
                                onClick={() => setStatus(b.id, 'confirmed')}
                                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 disabled:opacity-50"
                              >
                                <CheckCircle2 className="h-3 w-3" /> Confirm
                              </button>
                            )}
                            {(b.status === 'pending' || b.status === 'confirmed') && (
                              <>
                                <button
                                  disabled={isPending}
                                  onClick={() => setStatus(b.id, 'completed')}
                                  className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] bg-nb-800 border border-nb-700 text-nb-200 hover:bg-nb-700 disabled:opacity-50"
                                >
                                  <Clock className="h-3 w-3" /> Mark done
                                </button>
                                <button
                                  disabled={isPending}
                                  onClick={() => setStatus(b.id, 'cancelled')}
                                  className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] bg-nb-800 border border-nb-700 text-nb-300 hover:border-red-500/40 hover:text-red-400 disabled:opacity-50"
                                >
                                  <XCircle className="h-3 w-3" /> Cancel
                                </button>
                              </>
                            )}
                            {(b.status === 'cancelled' || b.status === 'completed') && (
                              <button
                                disabled={isPending}
                                onClick={() => setStatus(b.id, 'pending')}
                                className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] bg-nb-800 border border-nb-700 text-nb-300 hover:bg-nb-700 disabled:opacity-50"
                              >
                                <RefreshCw className="h-3 w-3" /> Reopen
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-top max-w-[260px]">
                          {editingNotesId === b.id ? (
                            <div className="flex flex-col gap-1">
                              <textarea
                                value={adminNotesDraft}
                                onChange={e => setAdminNotesDraft(e.target.value)}
                                rows={2}
                                placeholder="Internal notes (not shown to user)…"
                                className="w-full rounded bg-nb-800 border border-nb-700 text-[10px] text-white px-2 py-1 placeholder-nb-600 focus:outline-none focus:ring-1 focus:ring-nb-500 resize-none"
                              />
                              <div className="flex gap-1">
                                <button
                                  onClick={() => saveAdminNotes(b.id)}
                                  className="text-[10px] px-2 py-0.5 rounded bg-white text-nb-950 font-semibold"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingNotesId(null)}
                                  className="text-[10px] px-2 py-0.5 rounded text-nb-400 hover:text-white"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingNotesId(b.id)
                                setAdminNotesDraft(b.adminNotes ?? '')
                              }}
                              className="text-left w-full"
                            >
                              {b.adminNotes ? (
                                <p className="text-[10px] text-nb-300 leading-snug line-clamp-3 hover:text-white">
                                  {b.adminNotes}
                                </p>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] text-nb-600 hover:text-nb-300">
                                  <MessageSquare className="h-3 w-3" /> Add note
                                </span>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: BookingStatus }) {
  const config: Record<BookingStatus, { label: string; cls: string }> = {
    pending:   { label: 'Pending',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    confirmed: { label: 'Confirmed', cls: 'bg-green-500/15 text-green-400 border-green-500/30' },
    completed: { label: 'Completed', cls: 'bg-nb-800 text-nb-300 border-nb-700' },
    cancelled: { label: 'Cancelled', cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  }
  const c = config[status]
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${c.cls}`}>
      {c.label}
    </span>
  )
}
