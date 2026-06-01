ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS embedded_wallet_address TEXT;

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique
  ON users (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referral_payouts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id              UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE UNIQUE,
  challenge_id             UUID REFERENCES challenges(id) ON DELETE CASCADE,
  referrer_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referrer_stellar_address TEXT,
  referred_stellar_address  TEXT,
  referrer_amount_stroops   BIGINT NOT NULL DEFAULT 0,
  referred_amount_stroops   BIGINT NOT NULL DEFAULT 0,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'sent', 'failed')),
  tx_hash                  TEXT,
  error_message            TEXT NOT NULL DEFAULT '',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_payouts_failed_requires_message
    CHECK ((status = 'failed') = (LENGTH(error_message) > 0)),
  CONSTRAINT referral_payouts_amounts_positive CHECK (
    referrer_amount_stroops > 0 AND referred_amount_stroops > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_referrer_id ON referral_payouts (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_referred_id ON referral_payouts (referred_id);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_status ON referral_payouts (status);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'referral_payouts_updated_at') THEN
    EXECUTE 'CREATE TRIGGER referral_payouts_updated_at BEFORE UPDATE ON referral_payouts FOR EACH ROW EXECUTE FUNCTION set_updated_at()';
  END IF;
END $$;
