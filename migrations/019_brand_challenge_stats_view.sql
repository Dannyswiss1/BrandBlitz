-- Migration 019: Create brand_challenge_stats view for dashboard aggregation
-- This view aggregates game_sessions and session_round_scores per (brand_id, challenge_id)
-- to provide efficient dashboard queries without N+1 performance issues.

CREATE OR REPLACE VIEW brand_challenge_stats AS
SELECT
  c.brand_id,
  c.id AS challenge_id,
  COUNT(gs.id) AS total_sessions,
  COUNT(gs.id) FILTER (WHERE gs.status = 'completed') AS completed_sessions,
  ROUND(AVG(gs.total_score)::numeric, 2) AS avg_total_score,
  COUNT(DISTINCT gs.user_id) AS unique_players,
  COALESCE(SUM(p.amount_stroops) FILTER (WHERE p.status = 'completed'), 0) AS payout_total_stroops
FROM challenges c
LEFT JOIN game_sessions gs ON gs.challenge_id = c.id AND gs.flagged = false
LEFT JOIN payouts p ON p.session_id = gs.id
WHERE c.status NOT IN ('cancelled', 'refunded')
GROUP BY c.brand_id, c.id;
