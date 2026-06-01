-- Hot-path indexes for challenge state, leaderboards, and payout scans.
-- The schema uses `flagged` rather than `is_flagged`, so the partial
-- leaderboard index matches the actual query predicates in this repo.

CREATE INDEX IF NOT EXISTS idx_challenges_status_ends_at
  ON challenges (status, ends_at);

CREATE INDEX IF NOT EXISTS idx_game_sessions_leaderboard_hot_path
  ON game_sessions (challenge_id, total_score DESC)
  WHERE status = 'completed'
    AND flagged = FALSE
    AND is_practice = FALSE;

CREATE INDEX IF NOT EXISTS idx_payouts_challenge_id_status
  ON payouts (challenge_id, status);

