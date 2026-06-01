-- Migration 013: DB-level CHECK constraints for core numeric invariants
-- Complements Zod edge validation; rejects garbage if Zod is bypassed.

-- challenges: pool must be positive once the challenge is active
--   (pending_deposit and cancelled/refunded may still hold 0)
ALTER TABLE challenges
  ADD CONSTRAINT challenges_pool_amount_positive
    CHECK (
      status IN ('pending_deposit', 'cancelled', 'refunded')
      OR pool_amount_stroops > 0
    );

-- game_sessions: total score must be in [0, 450] (3 rounds × 150 max)
ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_score_range
    CHECK (total_score >= 0 AND total_score <= 450);

-- payouts: payout amounts must always be positive
ALTER TABLE payouts
  ADD CONSTRAINT payouts_amount_positive
    CHECK (amount_stroops > 0);
