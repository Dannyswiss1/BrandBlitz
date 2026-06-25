-- Migration 019: Add last_login timestamp to users table for audit trail.
-- Updated atomically alongside token rotation on every successful authentication.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_login ON users (last_login DESC);

-- Down:
-- ALTER TABLE users DROP COLUMN IF EXISTS last_login;
-- DROP INDEX IF EXISTS idx_users_last_login;
