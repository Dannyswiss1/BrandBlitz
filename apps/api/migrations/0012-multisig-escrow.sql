-- ─────────────────────────────────────────────────────────────────────────────
-- MULTISIG ESCROW OPERATIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks pending multisig operations (admin escrow actions: withdraw, close)
-- that require 2-of-3 hardware wallet co-signers before submission to Stellar.

CREATE TABLE multisig_cosigners (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL, -- "hardware_wallet_1", "hardware_wallet_2", "hardware_wallet_3", "hot_wallet"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_multisig_cosigners_role ON multisig_cosigners(role);

-- Pending multisig operations awaiting co-signatures
CREATE TABLE multisig_operations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id         TEXT NOT NULL, -- Challenge ID or escrow identifier
  operation_type    TEXT NOT NULL, -- "withdraw", "close_escrow", "distribute"
  xdr_unsigned      TEXT NOT NULL, -- Unsigned transaction XDR (base64)
  xdr_hash          TEXT NOT NULL, -- SHA-256 hash of unsigned XDR for signing
  threshold         INT NOT NULL DEFAULT 2, -- Required number of signatures
  created_by        UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at      TIMESTAMPTZ, -- When operation was finally submitted to Stellar
  submitted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  stellar_tx_hash   TEXT, -- Resulting transaction hash on Stellar
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | submitted | failed | expired
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  metadata          JSONB -- Operation-specific metadata (recipients, amounts, etc.)
);

CREATE INDEX idx_multisig_operations_escrow_id ON multisig_operations(escrow_id);
CREATE INDEX idx_multisig_operations_status ON multisig_operations(status);
CREATE INDEX idx_multisig_operations_created_by ON multisig_operations(created_by);
CREATE INDEX idx_multisig_operations_created_at ON multisig_operations(created_at DESC);

-- Signatures collected for a pending operation
CREATE TABLE multisig_signatures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id   UUID NOT NULL REFERENCES multisig_operations(id) ON DELETE CASCADE,
  signer_id      UUID NOT NULL REFERENCES multisig_cosigners(id) ON DELETE RESTRICT,
  xdr_signed     TEXT NOT NULL, -- Signed transaction envelope XDR (base64)
  signed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signer_role    TEXT NOT NULL -- Cached from cosigner for audit trail
);

CREATE UNIQUE INDEX idx_multisig_signatures_operation_signer
  ON multisig_signatures(operation_id, signer_id);
CREATE INDEX idx_multisig_signatures_operation_id ON multisig_signatures(operation_id);
CREATE INDEX idx_multisig_signatures_signer_id ON multisig_signatures(signer_id);

-- Audit log for multisig key ceremonies and signer rotations
CREATE TABLE multisig_audit (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL, -- "add_signer", "remove_signer", "rotate_key", "ceremony_init", "ceremony_complete"
  signer_id  UUID REFERENCES multisig_cosigners(id) ON DELETE SET NULL,
  old_value  JSONB, -- Previous state
  new_value  JSONB, -- New state
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_multisig_audit_actor_id ON multisig_audit(actor_id);
CREATE INDEX idx_multisig_audit_action ON multisig_audit(action);
CREATE INDEX idx_multisig_audit_created_at ON multisig_audit(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Add escrow_multisig_threshold to app_config (default 2-of-3)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO app_config (key, value)
VALUES ('escrow_multisig_threshold', '{"required": 2, "total": 3}')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cascade triggers for audit trail
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER multisig_cosigners_updated_at
BEFORE UPDATE ON multisig_cosigners
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER multisig_operations_updated_at
BEFORE UPDATE ON multisig_operations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
