-- ============================================================
-- Migration 035: discord_username on coaching_bookings
-- ============================================================
--
-- The /coaching page now collects a required Discord username so
-- admins know which Discord account to look for when running the
-- session. The existing coaching_bookings table (migration 006) has
-- topic, user_notes, admin_notes — we just bolt on one more column.
--
-- New rows enforce the field via the API/UI layer; existing rows
-- (pre-migration) are left NULL so this is a no-op for legacy data.

ALTER TABLE coaching_bookings
  ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- Index isn't worth adding (low cardinality vs total bookings, no
-- expected lookup-by-discord-username query pattern).
