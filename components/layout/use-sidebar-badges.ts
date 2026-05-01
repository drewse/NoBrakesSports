'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/types'

/**
 * Sidebar badge counts. Three signals:
 *
 *   • user `chatUnread`         — admin messages in the user's own room
 *                                 newer than `nb_chat_last_seen_at`
 *                                 (localStorage). Bumped to NOW whenever
 *                                 the user opens /chat — see useEffect
 *                                 in app/(app)/chat/chat-interface.tsx.
 *
 *   • admin `adminChatUnread`   — count of user-sent messages newer
 *                                 than that room's last_admin_read_at
 *                                 (from chat_room_state). Same shape
 *                                 the admin support inbox uses for its
 *                                 "Needs response" calculation.
 *
 *   • admin `adminBookings`     — count of pending coaching bookings
 *                                 with scheduled_at >= now (so past
 *                                 unattended slots don't pile up here).
 *
 * Subscribes to Realtime on chat_messages, chat_room_state, and
 * coaching_bookings so the badges update live without polling. Plus a
 * 60s safety re-fetch in case a Realtime event was missed.
 *
 * Localstorage key for the user-side last-seen marker:
 */
const CHAT_LAST_SEEN_KEY = 'nb_chat_last_seen_at'
const SAFETY_REFRESH_MS = 60_000

export interface SidebarBadges {
  chatUnread: number          // user-side; ignored when admin
  adminChatUnread: number     // admin-only
  adminBookings: number       // admin-only
}

const ZERO_BADGES: SidebarBadges = { chatUnread: 0, adminChatUnread: 0, adminBookings: 0 }

export function useSidebarBadges(profile: Profile | null): SidebarBadges {
  const [badges, setBadges] = useState<SidebarBadges>(ZERO_BADGES)

  const userId = profile?.id ?? null
  const isAdmin = !!profile?.is_admin

  const fetchAll = useCallback(async () => {
    if (!userId) return
    const supabase = createClient()

    // ── User-side chat unread ────────────────────────────────────
    // localStorage cursor is the easiest cross-tab signal; if the
    // value is missing we count everything in the last 30 days as
    // unread (post-onboarding bootstrap, won't blow up a normal user).
    let chatUnread = 0
    try {
      const lastSeen = typeof window !== 'undefined'
        ? window.localStorage.getItem(CHAT_LAST_SEEN_KEY)
        : null
      const cutoff = lastSeen ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const { count } = await supabase
        .from('chat_messages')
        .select('*', { count: 'exact', head: true })
        .eq('room_id', userId)
        .eq('is_admin_sender', true)
        .gt('created_at', cutoff)
      chatUnread = count ?? 0
    } catch { /* swallow — badge is non-critical */ }

    // ── Admin-side counts ────────────────────────────────────────
    let adminChatUnread = 0
    let adminBookings = 0
    if (isAdmin) {
      try {
        // Pending bookings — direct count.
        const { count: bookingsCount } = await supabase
          .from('coaching_bookings')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
          .gte('scheduled_at', new Date().toISOString())
        adminBookings = bookingsCount ?? 0

        // Admin chat unread — pull recent user-sent messages, then
        // pull last_admin_read_at per room, intersect in JS. Mirrors
        // the same logic the support-chats inbox uses to compute
        // "Needs response" per row, summed instead of grouped.
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
        const [{ data: msgs }, { data: states }] = await Promise.all([
          supabase
            .from('chat_messages')
            .select('room_id, created_at')
            .eq('is_admin_sender', false)
            .gt('created_at', since)
            .order('created_at', { ascending: false })
            .limit(1000),
          supabase
            .from('chat_room_state')
            .select('room_id, last_admin_read_at, status'),
        ])
        const stateByRoom = new Map(
          (states ?? []).map(s => [s.room_id, s] as const),
        )
        let n = 0
        for (const m of msgs ?? []) {
          const st = stateByRoom.get(m.room_id)
          if (st?.status === 'closed') continue
          const cutoff = st?.last_admin_read_at ?? null
          if (!cutoff || m.created_at > cutoff) n++
        }
        adminChatUnread = n
      } catch { /* swallow */ }
    }

    setBadges({ chatUnread, adminChatUnread, adminBookings })
  }, [userId, isAdmin])

  // Initial fetch + periodic safety refresh.
  useEffect(() => {
    if (!userId) return
    fetchAll()
    const id = setInterval(fetchAll, SAFETY_REFRESH_MS)
    return () => clearInterval(id)
  }, [userId, fetchAll])

  // localStorage sync — re-fetch when /chat page bumps the marker.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e: StorageEvent) => {
      if (e.key === CHAT_LAST_SEEN_KEY) fetchAll()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [fetchAll])

  // Realtime subscriptions — refresh on any relevant write.
  useEffect(() => {
    if (!userId) return
    const supabase = createClient()
    const channel = supabase
      .channel('sidebar-badges')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'chat_messages' },
        () => fetchAll())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'chat_room_state' },
        () => fetchAll())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'coaching_bookings' },
        () => { if (isAdmin) fetchAll() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, isAdmin, fetchAll])

  return badges
}

/**
 * Helper for the /chat page to bump the user's last-seen marker.
 * Triggers a storage event so the sidebar in this tab re-fetches
 * the unread count without a re-render dance.
 */
export function markChatSeen() {
  if (typeof window === 'undefined') return
  const now = new Date().toISOString()
  window.localStorage.setItem(CHAT_LAST_SEEN_KEY, now)
  // Manual storage event for same-tab listeners (the native
  // `storage` event only fires on OTHER tabs).
  window.dispatchEvent(new StorageEvent('storage', {
    key: CHAT_LAST_SEEN_KEY, newValue: now,
  }))
}
