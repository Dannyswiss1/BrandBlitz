-- Migration 018 DOWN: Remove minimum pool amount constraint

-- Drop the minimum pool constraint
ALTER TABLE challenges
  DROP CONSTRAINT IF EXISTS challenges_pool_min;

-- Re-add the original positive constraint
ALTER TABLE challenges
  ADD CONSTRAINT challenges_pool_amount_positive
    CHECK (
      status IN ('pending_deposit', 'cancelled', 'refunded')
      OR pool_amount_stroops > 0
    );
