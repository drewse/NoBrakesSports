-- ============================================================
-- Migration 035: coaching_bookings repair + discord_username
-- ============================================================
--
-- The /coaching page now collects a required Discord username so
-- admins know which Discord account to look for when running the
-- session.
--
-- Originally this migration was a one-line ADD COLUMN. On prod we
-- discovered migration 006 was never applied to the live DB
-- (same root cause as the chat_messages outage), so coaching_bookings
-- itself didn't exist and 035 aborted with:
--
--   ERROR: 42P01: relation "coaching_bookings" does not exist
--
-- This rewrite makes 035 self-sufficient and fully idempotent:
--   • Creates coaching_bookings with IF NOT EXISTS (table shape
--     mirrors migration 006, plus the new discord_username column)
--   • Enables RLS + drops/creates each policy so re-runs are safe
--   • ADD COLUMN IF NOT EXISTS discord_username covers the case
--     where 006 DID apply but 035 hadn't yet
--   • NOTIFY pgrst at the end refreshes PostgREST schema cache
--
-- Runs cleanly on any state of the DB:
--   - Fresh (no coaching_bookings)               → installs everything
--   - Has coaching_bookings, no discord_username → adds column
--   - Has both                                    → no-op

-- ── 1. Table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coaching_bookings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  admin_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  scheduled_at     TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','cancelled','completed')),
  topic            TEXT,
  user_notes       TEXT,
  admin_notes      TEXT,
  discord_username TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. discord_username on existing tables ───────────────────────
-- If the table existed before 035 (i.e., 006 was applied), the
-- table CREATE above is a no-op and we still need to add the column.
ALTER TABLE coaching_bookings
  ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- ── 3. RLS ────────────────────────────────────────────────────────
ALTER TABLE coaching_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own bookings" ON coaching_bookings;
CREATE POLICY "Users read own bookings"
  ON coaching_bookings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins read all bookings" ON coaching_bookings;
CREATE POLICY "Admins read all bookings"
  ON coaching_bookings FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

DROP POLICY IF EXISTS "Users insert own bookings" ON coaching_bookings;
CREATE POLICY "Users insert own bookings"
  ON coaching_bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own pending bookings" ON coaching_bookings;
CREATE POLICY "Users update own pending bookings"
  ON coaching_bookings FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admins update any booking" ON coaching_bookings;
CREATE POLICY "Admins update any booking"
  ON coaching_bookings FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ── 4. Refresh PostgREST schema cache ────────────────────────────
NOTIFY pgrst, 'reload schema';
