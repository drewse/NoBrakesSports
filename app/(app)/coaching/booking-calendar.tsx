'use client'

import { useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

interface Booking {
  scheduled_at: string
  status: string
}

interface Props {
  userId: string
  existingBookings: Booking[]   // all booked slots (any user) to grey out
  userBookings: Booking[]       // current user's own bookings for weekly limit
}

const SLOT_HOURS = [9, 9.5, 10, 10.5, 11, 11.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17]

function toHHMM(hour: number) {
  const h = Math.floor(hour)
  const m = hour % 1 === 0.5 ? '30' : '00'
  const ampm = h < 12 ? 'AM' : 'PM'
  const display = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${display}:${m} ${ampm}`
}

function isoSlot(date: Date, hour: number): string {
  const d = new Date(date)
  d.setHours(Math.floor(hour), hour % 1 === 0.5 ? 30 : 0, 0, 0)
  return d.toISOString()
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getWeekBounds(date: Date): { start: Date; end: Date } {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay()
  const start = new Date(d)
  start.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)) // Monday
  const end = new Date(start)
  end.setDate(start.getDate() + 7) // next Monday (exclusive)
  return { start, end }
}

export function BookingCalendar({ userId, existingBookings, userBookings }: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [weekStart, setWeekStart] = useState<Date>(() => {
    // Start from today (or next Monday if weekend)
    const d = new Date(today)
    const dow = d.getDay()
    if (dow === 0) d.setDate(d.getDate() + 1)
    if (dow === 6) d.setDate(d.getDate() + 2)
    return d
  })

  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 5 weekdays from weekStart
  const days = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i))
    .filter(d => d.getDay() !== 0 && d.getDay() !== 6)

  const bookedSlots = new Set(
    existingBookings
      .filter(b => b.status !== 'cancelled')
      .map(b => b.scheduled_at)
  )

  const now = new Date()

  // Check if user already has a non-cancelled booking in the current calendar week
  const { start: thisWeekStart, end: thisWeekEnd } = getWeekBounds(now)
  const hasBookingThisWeek = userBookings.some(b => {
    if (b.status === 'cancelled') return false
    const t = new Date(b.scheduled_at)
    return t >= thisWeekStart && t < thisWeekEnd
  })

  function isAvailable(date: Date, hour: number): boolean {
    const slot = new Date(date)
    slot.setHours(Math.floor(hour), hour % 1 === 0.5 ? 30 : 0, 0, 0)
    if (slot <= now) return false
    return !bookedSlots.has(slot.toISOString())
  }

  function prevWeek() {
    const prev = addDays(weekStart, -5)
    if (prev < today) return
    setWeekStart(prev)
    setSelectedSlot(null)
  }

  function nextWeek() {
    setWeekStart(addDays(weekStart, 5))
    setSelectedSlot(null)
  }

  async function handleBook() {
    if (!selectedSlot || !topic) return
    setError(null)

    startTransition(async () => {
      const supabase = createClient()
      const { error: err } = await supabase.from('coaching_bookings').insert({
        user_id: userId,
        scheduled_at: selectedSlot,
        topic,
        user_notes: notes || null,
        duration_minutes: 20,
        status: 'pending',
      })
      if (err) {
        setError(err.message)
      } else {
        setSuccess(true)
        bookedSlots.add(selectedSlot)
      }
    })
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 border border-green-500/30">
          <Check className="h-6 w-6 text-green-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">Session Requested!</p>
          <p className="text-nb-400 text-xs max-w-xs">
            We'll confirm your slot shortly via chat. Check the Chat tab for updates.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSuccess(false); setSelectedSlot(null); setTopic(''); setNotes('') }}
          className="text-nb-400 hover:text-white text-xs"
        >
          Book another session
        </Button>
      </div>
    )
  }

  const weekEndDate = days[days.length - 1]
  const weekLabel = `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTH_NAMES[weekEndDate.getMonth()]} ${weekEndDate.getDate()}, ${weekEndDate.getFullYear()}`

  if (hasBookingThisWeek) {
    const nextBooking = userBookings
      .filter(b => b.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30">
          <Check className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">Session Already Booked</p>
          <p className="text-nb-400 text-xs max-w-xs leading-relaxed">
            You have a session booked for this week. You can book your next session once your current week ends.
          </p>
          {nextBooking && (
            <p className="text-nb-300 text-xs mt-2 font-mono">
              {new Date(nextBooking.scheduled_at).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit',
              })}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={prevWeek}
          disabled={addDays(weekStart, -5) < today}
          className="p-1.5 rounded hover:bg-nb-800 text-nb-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium text-nb-300">{weekLabel}</span>
        <button
          onClick={nextWeek}
          className="p-1.5 rounded hover:bg-nb-800 text-nb-400 hover:text-white transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-5 gap-2">
        {days.map(day => (
          <div key={day.toDateString()}>
            <div className="text-center mb-2">
              <p className="text-[10px] text-nb-500 uppercase">{DAY_NAMES[day.getDay()]}</p>
              <p className="text-sm font-semibold text-white">{day.getDate()}</p>
            </div>
            <div className="space-y-1">
              {SLOT_HOURS.map(hour => {
                const iso = isoSlot(day, hour)
                const available = isAvailable(day, hour)
                const isSelected = selectedSlot === iso
                const isBooked = bookedSlots.has(iso)

                return (
                  <button
                    key={hour}
                    disabled={!available}
                    onClick={() => setSelectedSlot(iso)}
                    className={[
                      'w-full rounded text-[10px] py-1.5 transition-colors font-mono',
                      isSelected
                        ? 'bg-white text-nb-950 font-semibold'
                        : isBooked
                        ? 'bg-nb-800/50 text-nb-600 cursor-not-allowed line-through'
                        : available
                        ? 'bg-nb-800 text-nb-300 hover:bg-nb-700 hover:text-white'
                        : 'bg-nb-900 text-nb-700 cursor-not-allowed',
                    ].join(' ')}
                  >
                    {toHHMM(hour)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Booking form — shown when a slot is selected */}
      {selectedSlot && (
        <div className="rounded-lg border border-border bg-nb-900/60 p-4 space-y-3">
          <p className="text-xs font-semibold text-white">
            Booking for{' '}
            <span className="text-nb-300">
              {new Date(selectedSlot).toLocaleString('en-US', {
                weekday: 'long', month: 'short', day: 'numeric',
                hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
              })}
            </span>
          </p>

          <div className="space-y-2">
            <label className="block">
              <span className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                Topic <span className="text-white">*</span>
              </span>
              <select
                value={topic}
                onChange={e => setTopic(e.target.value)}
                className="mt-1 w-full rounded bg-nb-800 border border-nb-700 text-white text-xs px-3 py-2 focus:outline-none focus:ring-1 focus:ring-nb-500"
              >
                <option value="">Select a topic…</option>
                <option value="intro_bonus">Welcome / Intro Bonus Walkthrough</option>
                <option value="reload_promos">Reload & Ongoing Promotions</option>
                <option value="odds_boosts">Odds Boosts & Profit Boosts</option>
                <option value="risk_free">Risk-Free & No-Sweat Bet Strategy</option>
                <option value="refer_a_friend">Referral Programs</option>
                <option value="general">General Strategy Session</option>
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
                Notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Which books you're on, current balance, questions…"
                rows={2}
                className="mt-1 w-full rounded bg-nb-800 border border-nb-700 text-white text-xs px-3 py-2 placeholder-nb-600 focus:outline-none focus:ring-1 focus:ring-nb-500 resize-none"
              />
            </label>
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleBook}
              disabled={!topic || isPending}
              size="sm"
              className="flex-1 bg-white text-nb-950 hover:bg-nb-100 text-xs font-semibold"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Request Session'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedSlot(null)}
              className="text-nb-400 hover:text-white text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
