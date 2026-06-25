-- ─────────────────────────────────────────────────────────────────────────────
-- FEE BUMP TRANSACTION SUPPORT
-- ─────────────────────────────────────────────────────────────────────────────
-- Support for wrapping stuck payout transactions in fee bump envelopes
-- when Stellar base fee spikes above original submission fee.

ALTER TABLE payouts
ADD COLUMN fee_bump_attempts INTEGER NOT NULL DEFAULT 0,
ADD COLUMN fee_bump_max_fee_stroops BIGINT,
ADD COLUMN original_tx_hash TEXT;

-- Expand status enum to include fee bump states
ALTER TABLE payouts
DROP CONSTRAINT payouts_status_check;

ALTER TABLE payouts
ADD CONSTRAINT payouts_status_check
  CHECK (status IN (
    'pending',           -- Initial state
    'processing',        -- Submitted to Stellar
    'completed',         -- Successfully paid
    'fee_bump_pending',  -- Fee bump wrapping in progress
    'fee_bump_failed',   -- Fee bump submission failed
    'failed'             -- Permanently failed
  ));

CREATE INDEX idx_payouts_fee_bump_attempts 
  ON payouts (fee_bump_attempts) 
  WHERE status IN ('fee_bump_pending', 'fee_bump_failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- Add payout_max_fee_stroops to app_config (ceiling for fee bumps)
-- Default: 5000 stroops (0.005 XLM, reasonable ceiling for batch operations)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO app_config (key, value)
VALUES ('payout_max_fee_stroops', '{"maxFee": 5000}')
ON CONFLICT (key) DO NOTHING;
