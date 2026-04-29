-- ============================================================
-- NO BRAKES SPORTS — Affiliate Program
-- ============================================================
-- Adds the affiliates table that backs /affiliate and
-- /affiliate/dashboard?id=<code>. One row per signed-up affiliate.
-- Code must be unique (lowercase, 3-30 chars, letters/digits/-/_).

CREATE TYPE affiliate_type AS ENUM ('affiliate', 'creator', 'partner');
CREATE TYPE affiliate_status AS ENUM ('active', 'pending', 'disabled');

CREATE TABLE affiliates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  email TEXT NOT NULL,
  type affiliate_type NOT NULL DEFAULT 'affiliate',
  status affiliate_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Code is stored lowercase. Enforce shape at the DB level so a
  -- compromised client can't insert a malformed code via service role.
  CONSTRAINT affiliates_code_format CHECK (code ~ '^[a-z0-9_-]{3,30}$'),
  CONSTRAINT affiliates_code_unique UNIQUE (code),
  -- One affiliate row per user. Admins can override by deleting the row.
  CONSTRAINT affiliates_user_unique UNIQUE (user_id)
);

CREATE INDEX affiliates_user_id_idx ON affiliates(user_id);
CREATE INDEX affiliates_code_idx ON affiliates(code);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_affiliates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER affiliates_set_updated_at
  BEFORE UPDATE ON affiliates
  FOR EACH ROW EXECUTE FUNCTION set_affiliates_updated_at();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;

-- A user can read only their own affiliate row. Admins read all.
CREATE POLICY "Users can view own affiliate"
  ON affiliates FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Admins can view all affiliates"
  ON affiliates FOR SELECT USING (is_admin());

-- A user can create exactly one affiliate row, scoped to themselves.
-- (uniqueness is also enforced by the unique constraint above.)
CREATE POLICY "Users can insert own affiliate"
  ON affiliates FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- A user can update their own row (e.g. change email).
-- We do NOT allow updating user_id; uniqueness blocks moves anyway.
CREATE POLICY "Users can update own affiliate"
  ON affiliates FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "Admins can manage affiliates"
  ON affiliates FOR ALL USING (is_admin());
