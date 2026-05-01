-- ============================================================
-- One-off repair: install chat_messages on production
-- ============================================================
--
-- Production was reporting:
--   "Could not find the table 'public.chat_messages' in the schema cache"
-- which means migration 006 (which creates chat_messages) was never
-- successfully applied to this database despite the file existing in
-- the repo. The user-facing /chat page + the new admin inbox both
-- depend on this table.
--
-- This script reproduces the chat_messages section of migration 006
-- in a fully idempotent shape — every CREATE is guarded by
-- IF NOT EXISTS or wrapped in a DO/EXISTS check, so it's safe to run
-- on any state of the DB:
--
--   • chat_messages table missing → installs it
--   • chat_messages table present, policies missing → adds policies
--   • everything already in place → no-op (clean exit)
--
-- It also re-attaches the chat_messages_reopen_trigger from migration
-- 034 (which skipped attachment when chat_messages was missing).
--
-- ── How to run ────────────────────────────────────────────────────
-- Supabase Dashboard → SQL Editor. Paste the entire file. "Run as a
-- single transaction" can stay checked — none of these statements
-- need to escape a transaction. Should complete in under a second.
--
-- After running, restart your Supabase project's API or wait ~30s
-- for PostgREST to refresh its schema cache. The NOTIFY at the
-- bottom of this script triggers an immediate cache reload.

-- ── 1. chat_messages table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL,
  sender_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content         TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 4000),
  is_admin_sender BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- ── 2. RLS policies (idempotent) ─────────────────────────────────
-- Each policy: drop-if-exists then create. Cleaner than a DO block
-- with a pg_policies lookup.
DROP POLICY IF EXISTS "Users read own room" ON chat_messages;
CREATE POLICY "Users read own room"
  ON chat_messages FOR SELECT
  USING (auth.uid() = room_id);

DROP POLICY IF EXISTS "Admins read all rooms" ON chat_messages;
CREATE POLICY "Admins read all rooms"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
  );

DROP POLICY IF EXISTS "Users insert own room" ON chat_messages;
CREATE POLICY "Users insert own room"
  ON chat_messages FOR INSERT
  WITH CHECK (auth.uid() = room_id AND auth.uid() = sender_id AND is_admin_sender = FALSE);

DROP POLICY IF EXISTS "Admins insert any room" ON chat_messages;
CREATE POLICY "Admins insert any room"
  ON chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = TRUE)
    AND is_admin_sender = TRUE
  );

-- ── 3. Realtime publication ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
END $$;

-- ── 4. Index for fast room lookups ───────────────────────────────
CREATE INDEX IF NOT EXISTS chat_messages_room_created
  ON chat_messages (room_id, created_at DESC);

-- ── 5. Re-attach migration 034's auto-reopen trigger ─────────────
-- The function was created by 034. If 034 ran while chat_messages
-- was missing, the trigger creation was skipped. Attach it now.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'chat_messages_reopen_on_user_reply'
  ) THEN
    DROP TRIGGER IF EXISTS chat_messages_reopen_trigger ON chat_messages;
    CREATE TRIGGER chat_messages_reopen_trigger
      AFTER INSERT ON chat_messages
      FOR EACH ROW
      EXECUTE FUNCTION chat_messages_reopen_on_user_reply();
  ELSE
    RAISE NOTICE 'chat_messages_reopen_on_user_reply() not found — run migration 034 first.';
  END IF;
END $$;

-- ── 6. Refresh PostgREST schema cache ────────────────────────────
-- PostgREST caches the schema and won't pick up the new table
-- until reload. NOTIFY pgrst is the supported reload signal.
NOTIFY pgrst, 'reload schema';

-- ── 7. Sanity check ──────────────────────────────────────────────
-- After this script runs, the following query should return one row:
--   SELECT tablename FROM pg_tables WHERE tablename = 'chat_messages';
-- And the publication membership query should also return one row:
--   SELECT tablename FROM pg_publication_tables
--    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages';
