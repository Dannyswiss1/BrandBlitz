-- Migration 012: Add review workflow fields to fraud_flags
-- Enables state transitions (open → resolved | escalated) with audit trail

ALTER TABLE fraud_flags
  ADD COLUMN status            TEXT        NOT NULL DEFAULT 'open'
                               CONSTRAINT fraud_flags_status_check
                               CHECK (status IN ('open', 'resolved', 'escalated')),
  ADD COLUMN resolution_reason TEXT,
  ADD COLUMN resolved_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN resolved_at       TIMESTAMPTZ;

CREATE INDEX idx_fraud_flags_status ON fraud_flags (status);
