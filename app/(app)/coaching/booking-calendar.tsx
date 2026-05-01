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
  userName: string | null
  userEmail: string | null
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

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay()
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return d
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getWeekBounds(date: Date): { start: Date; end: Date } {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay()
  const start = new Date(d)
  start.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return { start, end }
}

// Lightweight Discord username sanity check. Discord allows letters,
// digits, underscores, dots, dashes; max 32 chars; legacy form may
// include a `#1234` discriminator. Don't be aggressive — Discord's
// own rules are complex and we just need a plausible string.
function isValidDiscord(raw: string): boolean {
  const v = raw.trim()
  if (v.length < 2 || v.length > 37) return false
  return /^[a-zA-Z0-9_.\-]{2,32}(#\d{4})?$/.test(v)
}

export function BookingCalendar({
  userId, userName, userEmail, existingBookings, userBookings,
}: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOfWeek(today))
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [topic, setTopic] = useState('')
  const [notes, setNotes] = useState('')
  const [discordUsername, setDiscordUsername] = useState('')
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ discord?: string; topic?: string }>({})

  const days = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i))

  const bookedSlots = new Set(
    existingBookings.filter(b => b.status !== 'cancelled').map(b => b.scheduled_at),
  )

  const now = new Date()
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

  const thisMonday = getMondayOfWeek(today)

  function prevWeek() {
    const prev = addDays(weekStart, -7)
    if (prev < thisMonday) return
    setWeekStart(prev)
    setSelectedSlot(null)
  }
  function nextWeek() {
    setWeekStart(addDays(weekStart, 7))
    setSelectedSlot(null)
  }

  async function handleBook() {
    if (!selectedSlot) return
    const errs: typeof fieldErrors = {}
    if (!topic) errs.topic = 'Pick a topic'
    if (!discordUsername.trim()) errs.discord = 'Discord username required'
    else if (!isValidDiscord(discordUsername)) errs.discord = 'Looks invalid — letters / digits / _ . - only (max 32, optional #1234)'
    setFieldErrors(errs)
    if (Object.keys(errs).length > 0) return
    setError(null)

    startTransition(async () => {
      const supabase = createClient()
      const { error: err } = await supabase.from('coaching_bookings').insert({
        user_id: userId,
        scheduled_at: selectedSlot,
        topic,
        user_notes: notes || null,
        discord_username: discordUsername.trim(),
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
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15 border border-green-500/30">
          <Check className="h-5 w-5 text-green-400" />
        </div>
        <div>
          <p className="text-white font-semibold text-sm mb-1">Session Requested!</p>
          <p className="text-nb-400 text-[11px] max-w-xs leading-relaxed">
            We&apos;ll confirm your slot shortly. Watch for a message in Chat or on Discord (
            <span className="text-nb-200">{discordUsername}</span>).
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
  const weekLabel = `${MONTH_NAMES[weekStart.getMonth()]} ${weekStart.getDate()} – ${MONTH_NAMES[weekEndDate.getMonth()]} ${weekEndDate.getDate()}`

  if (hasBookingThisWeek) {
    const nextBooking = userBookings
      .filter(b => b.status !== 'cancelled')
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())[0]
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2.5 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30">
          <Check className="h-4 w-4 text-amber-400" />
        </div>
        <p className="text-white font-semibold text-sm">Already Booked This Week</p>
        <p className="text-nb-400 text-[11px] max-w-xs leading-relaxed">
          One session per calendar week. Book again next Monday.
        </p>
        {nextBooking && (
          <p className="text-nb-200 text-xs font-mono">
            {new Date(nextBooking.scheduled_at).toLocaleString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
            })}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header — title + week nav inline so it eats minimal height */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-nb-400 uppercase tracking-wider">
          Choose a Time (EST)
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={prevWeek}
            disabled={weekStart <= thisMonday}
            className="p-1 rounded hover:bg-nb-800 text-nb-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-[11px] font-medium text-nb-300 min-w-[110px] text-center">{weekLabel}</span>
          <button
            onClick={nextWeek}
            className="p-1 rounded hover:bg-nb-800 text-nb-400 hover:text-white transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Day columns — compact */}
      <div className="grid grid-cols-5 gap-1.5">
        {days.map(day => (
          <div key={day.toDateString()}>
            <div className="text-center mb-1.5">
              <p className="text-[9px] text-nb-500 uppercase">{DAY_NAMES[day.getDay()]}</p>
              <p className="text-xs font-semibold text-white">{day.getDate()}</p>
            </div>
            <div className="space-y-0.5">
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
                      'w-full rounded text-[9px] py-1 transition-all font-mono',
                      isSelected
                        // Highly visible selected state — green ring
                        // matches the No Brakes accent and reads at
                        // a glance without changing layout dimensions.
                        ? 'bg-green-400 text-nb-950 font-bold ring-2 ring-green-400 ring-offset-2 ring-offset-nb-900 shadow-[0_0_12px_rgba(74,222,128,0.45)]'
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

      {/* Booking form — always rendered to reserve vertical space so
        * the calendar doesn't shift when a slot is picked. Inputs
        * disabled until a slot is selected so the layout stability
        * is free. */}
      <div className="rounded-lg border border-border bg-nb-900/60 p-3 space-y-2.5">
        <p className="text-[10px] font-semibold text-white">
          {selectedSlot ? (
            <>
              Booking for{' '}
              <span className="text-green-400 font-bold">
                {new Date(selectedSlot).toLocaleString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                })}
              </span>
            </>
          ) : (
            <span className="text-nb-500 font-normal">Pick a time above to start booking</span>
          )}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[9px] font-semibold text-nb-400 uppercase tracking-wider">
              Topic <span className="text-white">*</span>
            </span>
            <select
              value={topic}
              onChange={e => { setTopic(e.target.value); setFieldErrors(f => ({ ...f, topic: undefined })) }}
              disabled={!selectedSlot}
              className={`mt-0.5 w-full rounded bg-nb-800 border text-white text-[11px] px-2 py-1.5 focus:outline-none focus:ring-1 disabled:opacity-50 ${
                fieldErrors.topic ? 'border-red-500/50 focus:ring-red-500' : 'border-nb-700 focus:ring-nb-500'
              }`}
            >
              <option value="">Select topic…</option>
              <option value="intro_bonus">Intro Bonus Walkthrough</option>
              <option value="reload_promos">Reload Promotions</option>
              <option value="odds_boosts">Odds & Profit Boosts</option>
              <option value="risk_free">Risk-Free Bet Strategy</option>
              <option value="refer_a_friend">Referral Programs</option>
              <option value="general">General Strategy Session</option>
            </select>
          </label>

          <label className="block">
            <span className="text-[9px] font-semibold text-nb-400 uppercase tracking-wider">
              Discord Username <span className="text-white">*</span>
            </span>
            <input
              type="text"
              value={discordUsername}
              onChange={e => { setDiscordUsername(e.target.value); setFieldErrors(f => ({ ...f, discord: undefined })) }}
              disabled={!selectedSlot}
              placeholder="yourname or yourname#1234"
              maxLength={37}
              className={`mt-0.5 w-full rounded bg-nb-800 border text-white text-[11px] px-2 py-1.5 placeholder-nb-600 focus:outline-none focus:ring-1 disabled:opacity-50 ${
                fieldErrors.discord ? 'border-red-500/50 focus:ring-red-500' : 'border-nb-700 focus:ring-nb-500'
              }`}
            />
          </label>
        </div>

        <label className="block">
          <span className="text-[9px] font-semibold text-nb-400 uppercase tracking-wider">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={!selectedSlot}
            placeholder="Books you're on, current balance, questions…"
            rows={2}
            className="mt-0.5 w-full rounded bg-nb-800 border border-nb-700 text-white text-[11px] px-2 py-1.5 placeholder-nb-600 focus:outline-none focus:ring-1 focus:ring-nb-500 resize-none disabled:opacity-50"
          />
        </label>

        {(fieldErrors.discord || fieldErrors.topic || error) && (
          <p className="text-[10px] text-red-400">
            {fieldErrors.discord ?? fieldErrors.topic ?? error}
          </p>
        )}

        <div className="flex gap-1.5">
          <Button
            onClick={handleBook}
            disabled={!selectedSlot || isPending}
            size="sm"
            className="flex-1 bg-white text-nb-950 hover:bg-nb-100 text-[11px] font-semibold h-8"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Request Session'}
          </Button>
          {selectedSlot && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedSlot(null); setFieldErrors({}); setError(null) }}
              className="text-nb-400 hover:text-white text-[11px] h-8"
            >
              Clear
            </Button>
          )}
        </div>

        {/* Identity preview — confirms which account/email this
          * booking will be associated with. Helpful when admins ask
          * "is this the same email you signed up with?". */}
        {(userName || userEmail) && (
          <p className="text-[9px] text-nb-600 pt-1 border-t border-border/50">
            Booking as <span className="text-nb-400">{userName ?? userEmail}</span>
          </p>
        )}
      </div>
    </div>
  )
}
