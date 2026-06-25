-- ─────────────────────────────────────────────────────────────────────────────
-- DEPOSIT CONFIRMATION TRACKING
-- ─────────────────────────────────────────────────────────────────────────────
-- Track deposit ledger confirmations to prevent premature activation on
-- potentially-reverted transactions. Challenges remain pending_deposit until
-- deposit_confirmations >= required_confirmations (from app_config).

ALTER TABLE challenges
ADD COLUMN deposit_confirmations INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_challenges_deposit_confirmations 
  ON challenges (deposit_confirmations) 
  WHERE status = 'pending_deposit';

-- ─────────────────────────────────────────────────────────────────────────────
-- Add required_confirmations to app_config (default: 5 ledgers)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO app_config (key, value)
VALUES ('deposit_required_confirmations', '{"confirmations": 5}')
ON CONFLICT (key) DO NOTHING;
