-- Migration 018: DB trigger that blocks payout inserts for fraud-flagged sessions.
-- Provides an immutable safety net independent of application-level guards.

CREATE OR REPLACE FUNCTION prevent_payout_for_flagged_session()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM game_sessions
    WHERE challenge_id = NEW.challenge_id
      AND user_id      = NEW.user_id
      AND flagged      = TRUE
  ) THEN
    RAISE EXCEPTION 'FRAUD_BLOCKED_PAYOUT: session flagged for challenge % user %',
      NEW.challenge_id, NEW.user_id
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'payouts_fraud_block_trigger'
  ) THEN
    EXECUTE '
      CREATE TRIGGER payouts_fraud_block_trigger
        BEFORE INSERT ON payouts
        FOR EACH ROW EXECUTE FUNCTION prevent_payout_for_flagged_session()
    ';
  END IF;
END $$;

-- Down:
-- DROP TRIGGER IF EXISTS payouts_fraud_block_trigger ON payouts;
-- DROP FUNCTION IF EXISTS prevent_payout_for_flagged_session();
