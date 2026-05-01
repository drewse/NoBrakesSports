'use client'

import { useState, useEffect, useRef, useMemo, useTransition, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatRelativeTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Search, Send, Loader2, Lock, Unlock, ChevronLeft, MessageSquare,
  Inbox as InboxIcon, RefreshCw,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────

export interface Message {
  id: string
  room_id: string
  sender_id: string
  content: string
  is_admin_sender: boolean
  created_at: string
}

export interface ConversationRow {
  roomId: string
  userName: string
  userEmail: string
  avatarUrl: string | null
  userPlan: 'admin' | 'pro' | 'free'
  lastMessagePreview: string
  lastMessageAt: string
  lastMessageFromAdmin: boolean
  unreadCount: number
  needsResponse: boolean
  status: 'open' | 'closed'
  assignedAdminId: string | null
  closedAt: string | null
}

type SortMode = 'needs_response' | 'newest' | 'oldest' | 'pro_first'
type StatusFilter = 'all' | 'open' | 'closed' | 'needs_response' | 'unread'

// ── Component ─────────────────────────────────────────────────────

export function SupportInbox({
  initial,
  adminId,
}: {
  initial: ConversationRow[]
  adminId: string
}) {
  const [conversations, setConversations] = useState<ConversationRow[]>(initial)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    initial.find(c => c.needsResponse)?.roomId ?? initial[0]?.roomId ?? null,
  )
  const [thread, setThread] = useState<Message[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isSending, startSending] = useTransition()
  const [sendError, setSendError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('needs_response')
  const [search, setSearch] = useState('')
  const [actionPending, setActionPending] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)

  // ── Filtered + sorted conversation list ────────────────────────
  const visibleConversations = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = conversations.slice()
    // Filter by status / quick-filter
    if (statusFilter === 'open') list = list.filter(c => c.status === 'open')
    else if (statusFilter === 'closed') list = list.filter(c => c.status === 'closed')
    else if (statusFilter === 'needs_response') list = list.filter(c => c.needsResponse)
    else if (statusFilter === 'unread') list = list.filter(c => c.unreadCount > 0)
    // Search across user name / email / last preview text
    if (q) {
      list = list.filter(c =>
        c.userName.toLowerCase().includes(q) ||
        c.userEmail.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q),
      )
    }
    // Sort
    list.sort((a, b) => {
      if (sortMode === 'pro_first') {
        const ap = a.userPlan === 'pro' ? 0 : a.userPlan === 'admin' ? 1 : 2
        const bp = b.userPlan === 'pro' ? 0 : b.userPlan === 'admin' ? 1 : 2
        if (ap !== bp) return ap - bp
        return b.lastMessageAt.localeCompare(a.lastMessageAt)
      }
      if (sortMode === 'oldest') return a.lastMessageAt.localeCompare(b.lastMessageAt)
      if (sortMode === 'newest') return b.lastMessageAt.localeCompare(a.lastMessageAt)
      // needs_response (default)
      if (a.needsResponse !== b.needsResponse) return a.needsResponse ? -1 : 1
      return b.lastMessageAt.localeCompare(a.lastMessageAt)
    })
    return list
  }, [conversations, statusFilter, sortMode, search])

  const selected = useMemo(
    () => conversations.find(c => c.roomId === selectedRoomId) ?? null,
    [conversations, selectedRoomId],
  )

  const inboxNeedsResponseCount = useMemo(
    () => conversations.filter(c => c.needsResponse).length,
    [conversations],
  )

  // ── Load thread when selection changes ─────────────────────────
  useEffect(() => {
    if (!selectedRoomId) { setThread([]); return }
    let cancelled = false
    setThreadLoading(true)
    setThreadError(null)
    const supabase = createClient()
    supabase
      .from('chat_messages')
      .select('id, room_id, sender_id, content, is_admin_sender, created_at')
      .eq('room_id', selectedRoomId)
      .order('created_at', { ascending: true })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setThreadError(error.message)
        else setThread((data ?? []) as Message[])
        setThreadLoading(false)
      })
    return () => { cancelled = true }
  }, [selectedRoomId])

  // Auto-scroll to bottom on thread change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [thread])

  // Auto-mark-read on selection (fire-and-forget; UI updates optimistically below).
  useEffect(() => {
    if (!selectedRoomId) return
    const ac = new AbortController()
    fetch(`/api/admin/chat/${selectedRoomId}/read`, {
      method: 'POST',
      signal: ac.signal,
    }).catch(() => { /* ignore — Realtime will eventually catch up */ })
    // Optimistically zero out unread + needsResponse for this row
    setConversations(prev => prev.map(c =>
      c.roomId === selectedRoomId
        ? { ...c, unreadCount: 0, needsResponse: false }
        : c,
    ))
    return () => ac.abort()
  }, [selectedRoomId])

  // ── Realtime: live updates for inbox + thread ──────────────────
  useEffect(() => {
    const supabase = createClient()
    // Subscribe to ALL chat_messages inserts. Admin RLS allows reading
    // any room, so we'll receive every event.
    const messagesChan = supabase
      .channel('admin-inbox-messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const msg = payload.new as Message
          // Append to thread if we're viewing this room.
          if (msg.room_id === selectedRoomId) {
            setThread(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
          }
          // Update inbox row (move to top, bump unread, refresh preview).
          setConversations(prev => {
            const existing = prev.find(c => c.roomId === msg.room_id)
            const isUserMsg = !msg.is_admin_sender
            const isViewing = msg.room_id === selectedRoomId
            if (existing) {
              return prev.map(c => {
                if (c.roomId !== msg.room_id) return c
                return {
                  ...c,
                  lastMessagePreview: msg.content.slice(0, 200),
                  lastMessageAt: msg.created_at,
                  lastMessageFromAdmin: msg.is_admin_sender,
                  // Bump unread only if it's a user msg AND we're not actively viewing.
                  unreadCount: isUserMsg && !isViewing ? c.unreadCount + 1 : (isViewing ? 0 : c.unreadCount),
                  needsResponse: isUserMsg && c.status === 'open' && !isViewing,
                  // A new user message on a closed room reopens it (DB trigger handles).
                  status: isUserMsg && c.status === 'closed' ? 'open' : c.status,
                }
              })
            }
            // Brand-new room — best-effort insert with placeholder name.
            // The next page reload will fill in the proper profile data.
            return [{
              roomId: msg.room_id,
              userName: 'New conversation',
              userEmail: '',
              avatarUrl: null,
              userPlan: 'free',
              lastMessagePreview: msg.content.slice(0, 200),
              lastMessageAt: msg.created_at,
              lastMessageFromAdmin: msg.is_admin_sender,
              unreadCount: isUserMsg ? 1 : 0,
              needsResponse: isUserMsg,
              status: 'open',
              assignedAdminId: null,
              closedAt: null,
            }, ...prev]
          })
        },
      )
      .subscribe()

    // Subscribe to chat_room_state for status changes.
    const stateChan = supabase
      .channel('admin-inbox-state')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_room_state' },
        (payload) => {
          const next = payload.new as { room_id: string; status: 'open' | 'closed'; last_admin_read_at: string | null; closed_at: string | null }
          if (!next?.room_id) return
          setConversations(prev => prev.map(c =>
            c.roomId === next.room_id
              ? { ...c, status: next.status, closedAt: next.closed_at }
              : c,
          ))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(messagesChan)
      supabase.removeChannel(stateChan)
    }
  }, [selectedRoomId])

  // ── Send / close / reopen handlers ─────────────────────────────
  const send = useCallback(() => {
    const text = draft.trim()
    if (!text || !selectedRoomId || isSending) return
    setSendError(null)
    setDraft('')
    startSending(async () => {
      const res = await fetch('/api/admin/chat/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: selectedRoomId, content: text }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSendError(body?.error ?? `send failed (${res.status})`)
        setDraft(text)
        return
      }
      // Optimistic append — same fix as the user-facing chat. The
      // realtime echo will eventually arrive but the dedup check
      // (m.id ===) makes this safe.
      const msg = body?.message as Message | undefined
      if (msg && msg.room_id === selectedRoomId) {
        setThread(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg])
      }
      // Update the inbox row's preview immediately so the list
      // doesn't lag behind realtime.
      if (msg) {
        setConversations(prev => prev.map(c =>
          c.roomId === selectedRoomId
            ? {
                ...c,
                lastMessagePreview: msg.content.slice(0, 200),
                lastMessageAt: msg.created_at,
                lastMessageFromAdmin: true,
                needsResponse: false,
              }
            : c,
        ))
      }
    })
  }, [draft, selectedRoomId, isSending])

  const setStatus = useCallback(async (next: 'open' | 'closed') => {
    if (!selectedRoomId || actionPending) return
    setActionPending(true)
    // Optimistic
    setConversations(prev => prev.map(c =>
      c.roomId === selectedRoomId ? { ...c, status: next } : c,
    ))
    try {
      const res = await fetch(`/api/admin/chat/${selectedRoomId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error(`status update failed (${res.status})`)
    } catch (e) {
      // Roll back optimistic change on failure
      setConversations(prev => prev.map(c =>
        c.roomId === selectedRoomId ? { ...c, status: next === 'open' ? 'closed' : 'open' } : c,
      ))
    } finally {
      setActionPending(false)
    }
  }, [selectedRoomId, actionPending])

  const refresh = () => {
    // Hard reload — re-runs the SSR loader, refetching every conversation
    // with fresh profile metadata. Cheap for an admin-only page.
    window.location.reload()
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* ── LEFT: conversation list ─────────────────────────────── */}
      <aside className={`lg:w-96 lg:border-r border-border bg-nb-950 flex flex-col ${selectedRoomId ? 'hidden lg:flex' : 'flex'}`}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-white">Support Chats</h1>
            {inboxNeedsResponseCount > 0 && (
              <Badge variant="down_status" className="text-[10px] !bg-red-500/15 !text-red-400 !border !border-red-500/30">
                {inboxNeedsResponseCount} need response
              </Badge>
            )}
          </div>
          <button
            onClick={refresh}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-nb-400 hover:text-white hover:bg-nb-800 transition-colors"
            title="Refresh inbox"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-nb-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, email, message…"
              className="w-full h-9 pl-9 pr-3 rounded-md bg-nb-900 border border-nb-800 text-xs text-white placeholder-nb-600 focus:outline-none focus:border-nb-600"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="px-3 pt-2 pb-2 flex items-center gap-1.5 flex-wrap">
          {([
            ['all', 'All'],
            ['needs_response', 'Needs response'],
            ['unread', 'Unread'],
            ['open', 'Open'],
            ['closed', 'Closed'],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setStatusFilter(k)}
              className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                statusFilter === k
                  ? 'bg-white text-nb-950 border-white'
                  : 'bg-transparent text-nb-400 border-nb-800 hover:border-nb-600 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="px-3 pb-3 border-b border-border">
          <select
            value={sortMode}
            onChange={e => setSortMode(e.target.value as SortMode)}
            className="w-full h-8 px-2 rounded-md bg-nb-900 border border-nb-800 text-[11px] text-nb-300 focus:outline-none focus:border-nb-600"
          >
            <option value="needs_response">Sort: Needs response first</option>
            <option value="newest">Sort: Newest activity</option>
            <option value="oldest">Sort: Oldest activity</option>
            <option value="pro_first">Sort: Pro users first</option>
          </select>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {visibleConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-nb-800 border border-nb-700">
                <InboxIcon className="h-5 w-5 text-nb-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white mb-1">No conversations</p>
                <p className="text-xs text-nb-500">
                  {search || statusFilter !== 'all'
                    ? 'No conversations match your filters.'
                    : 'When users message the No Brakes team, they appear here.'}
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {visibleConversations.map(c => (
                <li key={c.roomId}>
                  <button
                    onClick={() => setSelectedRoomId(c.roomId)}
                    className={`w-full text-left px-4 py-3 hover:bg-nb-900/60 transition-colors ${
                      selectedRoomId === c.roomId ? 'bg-nb-900' : ''
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={c.userName} url={c.avatarUrl} unread={c.unreadCount > 0} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <p className={`text-xs font-semibold truncate ${c.unreadCount > 0 ? 'text-white' : 'text-nb-200'}`}>
                            {c.userName}
                          </p>
                          {c.userPlan === 'pro' && <Badge variant="pro" className="text-[8px] px-1 py-0">PRO</Badge>}
                          {c.userPlan === 'admin' && <Badge variant="white" className="text-[8px] px-1 py-0">ADMIN</Badge>}
                          {c.status === 'closed' && <Badge variant="muted" className="text-[8px] px-1 py-0">CLOSED</Badge>}
                          <span className="ml-auto text-[10px] text-nb-600 shrink-0">
                            {formatRelativeTime(c.lastMessageAt)}
                          </span>
                        </div>
                        <p className={`text-[11px] truncate ${c.unreadCount > 0 ? 'text-nb-200' : 'text-nb-500'}`}>
                          {c.lastMessageFromAdmin && <span className="text-nb-600">You: </span>}
                          {c.lastMessagePreview}
                        </p>
                        <div className="flex items-center gap-1.5 mt-1">
                          {c.needsResponse && (
                            <Badge variant="down_status" className="text-[8px] px-1 py-0 !bg-red-500/15 !text-red-400 !border !border-red-500/30">
                              Needs response
                            </Badge>
                          )}
                          {c.unreadCount > 0 && (
                            <span className="text-[9px] font-mono text-red-400">
                              {c.unreadCount > 99 ? '99+' : c.unreadCount} unread
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* ── RIGHT: thread ─────────────────────────────────────────── */}
      <main className={`flex-1 flex flex-col bg-nb-950 ${selectedRoomId ? 'flex' : 'hidden lg:flex'}`}>
        {!selected ? (
          <div className="flex flex-1 items-center justify-center text-center p-8">
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-nb-800 border border-nb-700">
                <MessageSquare className="h-6 w-6 text-nb-400" />
              </div>
              <p className="text-sm font-medium text-white">Select a conversation</p>
              <p className="text-xs text-nb-500 max-w-xs">
                Pick a chat from the list to view the thread and reply as the No Brakes team.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <header className="px-4 py-3 border-b border-border flex items-center gap-3 bg-nb-950">
              <button
                onClick={() => setSelectedRoomId(null)}
                className="lg:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-nb-400 hover:text-white hover:bg-nb-800"
                aria-label="Back to inbox"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <Avatar name={selected.userName} url={selected.avatarUrl} unread={false} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-white truncate">{selected.userName}</p>
                  {selected.userPlan === 'pro' && <Badge variant="pro" className="text-[9px]">PRO</Badge>}
                  {selected.userPlan === 'admin' && <Badge variant="white" className="text-[9px]">ADMIN</Badge>}
                  {selected.status === 'closed' && <Badge variant="muted" className="text-[9px]">CLOSED</Badge>}
                </div>
                <p className="text-[10px] text-nb-500 truncate">{selected.userEmail}</p>
              </div>
              {selected.status === 'open' ? (
                <button
                  onClick={() => setStatus('closed')}
                  disabled={actionPending}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-nb-800 text-[11px] font-medium text-nb-300 hover:border-nb-600 hover:text-white transition-colors disabled:opacity-50"
                >
                  <Lock className="h-3 w-3" />
                  Close
                </button>
              ) : (
                <button
                  onClick={() => setStatus('open')}
                  disabled={actionPending}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-nb-800 text-[11px] font-medium text-green-400 hover:border-green-500/50 transition-colors disabled:opacity-50"
                >
                  <Unlock className="h-3 w-3" />
                  Reopen
                </button>
              )}
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {threadLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-4 w-4 animate-spin text-nb-500" />
                </div>
              )}
              {threadError && (
                <div className="text-center text-xs text-red-400 py-8">
                  Failed to load thread: {threadError}
                </div>
              )}
              {!threadLoading && !threadError && thread.length === 0 && (
                <div className="text-center text-xs text-nb-500 py-12">
                  No messages yet.
                </div>
              )}
              {thread.map((msg, i) => {
                const isAdmin = msg.is_admin_sender
                const showDate =
                  i === 0 ||
                  new Date(msg.created_at).toDateString() !==
                    new Date(thread[i - 1].created_at).toDateString()
                return (
                  <div key={msg.id}>
                    {showDate && (
                      <div className="flex items-center gap-3 my-4">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-[10px] text-nb-600 whitespace-nowrap">
                          {new Date(msg.created_at).toLocaleDateString('en-US', {
                            weekday: 'short', month: 'short', day: 'numeric',
                          })}
                        </span>
                        <div className="flex-1 h-px bg-border" />
                      </div>
                    )}
                    <div className={`flex gap-2.5 ${isAdmin ? 'flex-row-reverse' : ''}`}>
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        isAdmin ? 'bg-white text-nb-950' : 'bg-nb-700 text-white'
                      }`}>
                        {isAdmin ? 'NB' : initials(selected.userName)}
                      </div>
                      <div className={`max-w-[75%] flex flex-col gap-0.5 ${isAdmin ? 'items-end' : 'items-start'}`}>
                        <div className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                          isAdmin ? 'bg-white text-nb-950 rounded-tr-sm' : 'bg-nb-800 text-white rounded-tl-sm'
                        }`}>
                          {msg.content}
                        </div>
                        <span className="text-[9px] text-nb-600 px-1">
                          {formatRelativeTime(msg.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-border p-3 bg-nb-950">
              {sendError && <p className="text-[10px] text-red-400 mb-2 px-1">{sendError}</p>}
              <div className="flex gap-2 items-end">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }}
                  placeholder={selected.status === 'closed'
                    ? 'Conversation closed. Reopen to reply, or sending will reopen automatically.'
                    : 'Reply as No Brakes Team…'}
                  rows={1}
                  className="flex-1 rounded-xl bg-nb-800 border border-nb-700 text-white text-xs px-3.5 py-2.5 placeholder-nb-600 focus:outline-none focus:ring-1 focus:ring-nb-500 resize-none leading-relaxed"
                  style={{ minHeight: '40px', maxHeight: '160px' }}
                />
                <button
                  onClick={send}
                  disabled={!draft.trim() || isSending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-nb-950 hover:bg-nb-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Send"
                >
                  {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[9px] text-nb-700 mt-1.5 px-1">
                Enter to send · Shift+Enter for new line · Replying as No Brakes Team
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

function Avatar({ name, url, unread }: { name: string; url: string | null; unread: boolean }) {
  return (
    <div className="relative shrink-0">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-9 w-9 rounded-full object-cover bg-nb-800" />
      ) : (
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-nb-700 text-white text-[10px] font-bold">
          {initials(name)}
        </div>
      )}
      {unread && (
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 border-2 border-nb-950" />
      )}
    </div>
  )
}

