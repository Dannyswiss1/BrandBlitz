-- Add deleted_at to users and challenges for soft-delete pattern.
-- Brands already has this from the initial schema.

ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users (deleted_at);

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_challenges_deleted_at ON challenges (deleted_at);
