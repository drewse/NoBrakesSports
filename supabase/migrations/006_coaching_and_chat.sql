-- ── Coaching bookings ────────────────────────────────────────────────────────
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
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE coaching_bookings ENABLE ROW LEVEL SECURITY;

-- Users see only their own bookings
CREATE POLICY "Users read own bookings"
  ON coaching_bookings FOR SELECT
  USING (auth.uid() = user_id);

-- Admins see all bookings
CREATE POLICY "Admins read all bookings"
  ON coaching_bookings FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Users can insert their own bookings
CREATE POLICY "Users insert own bookings"
  ON coaching_bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can cancel their own pending bookings
CREATE POLICY "Users update own pending bookings"
  ON coaching_bookings FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

-- Admins can update any booking
CREATE POLICY "Admins update any booking"
  ON coaching_bookings FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ── Chat messages ─────────────────────────────────────────────────────────────
-- Each user has their own room (room_id = user_id) shared with all admins.
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL,   -- equals the user's profile id
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 4000),
  is_admin_sender BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Users can read messages in their own room
CREATE POLICY "Users read own room"
  ON chat_messages FOR SELECT
  USING (auth.uid() = room_id);

-- Admins can read any room
CREATE POLICY "Admins read all rooms"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Users can send to their own room
CREATE POLICY "Users insert own room"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = room_id AND auth.uid() = sender_id AND is_admin_sender = FALSE);

-- Admins can send to any room
CREATE POLICY "Admins insert any room"
  ON chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
    AND is_admin_sender = TRUE
  );

-- Enable realtime on chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;

-- Index for fast room lookups
CREATE INDEX IF NOT EXISTS chat_messages_room_created
  ON chat_messages (room_id, created_at DESC);
