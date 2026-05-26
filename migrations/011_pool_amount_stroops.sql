ALTER TABLE challenges
  ADD COLUMN IF NOT EXISTS pool_amount_stroops BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'challenges'
      AND column_name = 'pool_amount_usdc'
  ) THEN
    EXECUTE 'UPDATE challenges SET pool_amount_stroops = (pool_amount_usdc * 10000000)::bigint';
    EXECUTE 'ALTER TABLE challenges DROP COLUMN pool_amount_usdc';
  END IF;
END $$;

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS amount_stroops BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'payouts'
      AND column_name = 'amount_usdc'
  ) THEN
    EXECUTE 'UPDATE payouts SET amount_stroops = (amount_usdc * 10000000)::bigint';
    EXECUTE 'ALTER TABLE payouts DROP COLUMN amount_usdc';
  END IF;
END $$;
