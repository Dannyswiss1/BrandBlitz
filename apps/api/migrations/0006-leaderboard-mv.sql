-- Materialised view for the global cross-challenge leaderboard.
--
-- Unique index on (challenge_id, rank) serves two purposes:
--   1. Required by PostgreSQL for REFRESH MATERIALIZED VIEW CONCURRENTLY
--   2. Enables index-range scans when the route filters by challenge_id + rank,
--      allowing index-only scans on a freshly-refreshed view.
--
-- Refresh is triggered from a BullMQ job each time a challenge ends.

CREATE MATERIALIZED VIEW v_leaderboard_global AS
SELECT
  gs.challenge_id,
  ROW_NUMBER() OVER (
    PARTITION BY gs.challenge_id
    ORDER BY gs.total_score DESC, gs.completed_at ASC
  )::int                          AS rank,
  gs.user_id,
  u.email                         AS username,
  u.display_name,
  u.league,
  u.avatar_url,
  gs.total_score,
  u.total_earned_usdc
FROM game_sessions gs
JOIN users u ON u.id = gs.user_id
WHERE gs.flagged     = FALSE
  AND gs.is_practice = FALSE
  AND gs.status      = 'completed'
  AND u.deleted_at   IS NULL
WITH NO DATA;

CREATE UNIQUE INDEX idx_v_leaderboard_global_challenge_rank
  ON v_leaderboard_global (challenge_id, rank);

-- Populate immediately so the first request is not served from an empty view.
REFRESH MATERIALIZED VIEW v_leaderboard_global;
