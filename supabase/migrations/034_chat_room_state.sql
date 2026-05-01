-- ============================================================
-- Migration 034: chat_room_state — admin-side support inbox
-- ============================================================
--
-- The user-facing /chat page already works against chat_messages
-- (migration 006). It treats each user's room (room_id = user_id) as
-- an implicit conversation. The admin inbox needs a few additional
-- fields that don't fit on chat_messages:
--
--   • status: open | closed
--   • last_admin_read_at — drives unread count and "Needs response"
--   • assigned_admin_id  — optional, for future admin handoff
--   • closed_at / closed_by — audit trail when an admin resolves
--
-- We deliberately do NOT migrate to a normalized (conversations,
-- messages) shape. The existing user UI + realtime subscription on
-- chat_messages keeps working unchanged. This sibling table is
-- admin-only state tracking.
--
-- "Needs response" derivation (computed in the loader, not stored):
--   latest message in chat_messages WHERE room_id = X
--     AND is_admin_sender = FALSE
--     AND created_at > coalesce(last_admin_read_at, '-infinity')
--     AND status != 'closed'
--   → conversation needs a response.

CREATE TABLE IF NOT EXISTS chat_room_state (
  room_id            UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'closed')),
  last_admin_read_at TIMESTAMPTZ,
  assigned_admin_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  closed_at          TIMESTAMPTZ,
  closed_by          UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_room_state ENABLE ROW LEVEL SECURITY;

-- Users can read their own room's state (so the user UI can show
-- "this conversation has been closed" if we ever surface that).
CREATE POLICY "Users read own room state"
  ON chat_room_state FOR SELECT
  USING (auth.uid() = room_id);

-- Admins read all room states.
CREATE POLICY "Admins read all room states"
  ON chat_room_state FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Only admins can insert / update room state. Users have no write
-- access — they don't manage their own status, last-admin-read, etc.
CREATE POLICY "Admins insert room state"
  ON chat_room_state FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

CREATE POLICY "Admins update room state"
  ON chat_room_state FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- Realtime so the admin inbox count + status badges update without
-- polling whenever an admin marks read / closes.
ALTER PUBLICATION supabase_realtime ADD TABLE chat_room_state;

-- Auto-bump updated_at on any change.
CREATE OR REPLACE FUNCTION chat_room_state_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_room_state_updated_at ON chat_room_state;
CREATE TRIGGER chat_room_state_updated_at
  BEFORE UPDATE ON chat_room_state
  FOR EACH ROW
  EXECUTE FUNCTION chat_room_state_touch_updated_at();

-- Auto-reopen on new user message: if a user posts to a closed room,
-- flip the room state back to 'open' so the admin inbox surfaces it
-- as a fresh conversation. Cleaner UX than blocking the user reply
-- (the user wouldn't know why their message vanished).
CREATE OR REPLACE FUNCTION chat_messages_reopen_on_user_reply()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin_sender = FALSE THEN
    INSERT INTO chat_room_state (room_id, status)
    VALUES (NEW.room_id, 'open')
    ON CONFLICT (room_id) DO UPDATE
      SET status = 'open',
          closed_at = NULL,
          closed_by = NULL
      WHERE chat_room_state.status = 'closed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS chat_messages_reopen_trigger ON chat_messages;
CREATE TRIGGER chat_messages_reopen_trigger
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION chat_messages_reopen_on_user_reply();
