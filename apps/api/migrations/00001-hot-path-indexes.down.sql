-- Roll back the hot-path indexes introduced in 00001-hot-path-indexes.sql.

DROP INDEX IF EXISTS idx_payouts_challenge_id_status;
DROP INDEX IF EXISTS idx_game_sessions_leaderboard_hot_path;
DROP INDEX IF EXISTS idx_challenges_status_ends_at;

