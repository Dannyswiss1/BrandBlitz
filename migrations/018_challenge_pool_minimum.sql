-- Migration 018: Enforce minimum pool amount of 100 USDC (1,000,000,000 stroops)
-- for active challenges to prevent dust-level prize pools.

-- Add the CHECK constraint
ALTER TABLE challenges
  ADD CONSTRAINT challenges_pool_min
    CHECK (
      status IN ('pending_deposit', 'cancelled', 'refunded')
      OR pool_amount_stroops >= 1000000000
    );

-- Update existing constraint to work with the new one
-- The existing challenges_pool_amount_positive constraint should be removed
-- as it's now covered by challenges_pool_min
ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_pool_amount_positive;
