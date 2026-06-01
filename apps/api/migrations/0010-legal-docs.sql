-- Legal documents & user acceptance tables for TOS / Privacy versioning.

CREATE TABLE IF NOT EXISTS legal_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version       TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('tos', 'privacy')),
  body_markdown TEXT NOT NULL,
  effective_at  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (type, version)
);

CREATE TABLE IF NOT EXISTS user_legal_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('tos', 'privacy')),
  version       TEXT NOT NULL,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip            TEXT NOT NULL DEFAULT '',
  UNIQUE (user_id, type, version)
);

CREATE INDEX IF NOT EXISTS idx_legal_documents_type_effective
  ON legal_documents (type, effective_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_legal_acceptances_user_type
  ON user_legal_acceptances (user_id, type, version DESC);
