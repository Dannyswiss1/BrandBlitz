ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_status_check,
  ADD CONSTRAINT challenges_status_check
    CHECK (status IN ('pending_deposit', 'active', 'ended', 'settled', 'payout_failed', 'cancelled', 'refunded'));

ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_pool_amount_positive,
  ADD CONSTRAINT challenges_pool_amount_positive
    CHECK (status IN ('pending_deposit', 'cancelled', 'refunded') OR pool_amount_stroops > 0);

CREATE TABLE IF NOT EXISTS refunds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id     UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE UNIQUE,
  admin_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  reason           TEXT NOT NULL,
  amount_stroops   BIGINT NOT NULL CHECK (amount_stroops > 0),
  destination      TEXT NOT NULL,
  tx_hash          TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refunds_admin_id ON refunds (admin_id);
CREATE INDEX IF NOT EXISTS idx_refunds_tx_hash  ON refunds (tx_hash);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'refunds_updated_at'
  ) THEN
    CREATE TRIGGER refunds_updated_at
      BEFORE UPDATE ON refunds
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
