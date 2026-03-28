/**
 * Shared pre-game filter utilities.
 *
 * All timestamps in the database are stored as UTC ISO strings.
 * JavaScript's new Date().toISOString() returns UTC, so comparisons
 * are timezone-safe without any conversion.
 *
 * UPCOMING = start_time > now (game has not yet started)
 * STARTED  = start_time <= now (game is at or past its kickoff time)
 *
 * This app is pre-game only. Any event whose start_time has passed
 * must not appear on user-facing pages.
 */

/** Current UTC time as an ISO string — use as the lower-bound for upcoming events. */
export function upcomingCutoff(): string {
  return new Date().toISOString()
}

/**
 * Returns true when an event's start_time is strictly in the future.
 * Use this for client-side filtering of embedded event objects
 * returned in snapshot queries.
 */
export function isUpcomingEvent(startTime: string | null | undefined): boolean {
  if (!startTime) return false
  return startTime > new Date().toISOString()
}
