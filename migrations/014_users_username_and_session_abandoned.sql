-- Backfill usernames for existing users, drop muxed_id, and allow abandoned sessions.

WITH base_usernames AS (
  SELECT
    id,
    COALESCE(
      NULLIF(lower(regexp_replace(display_name, '[^a-z0-9]+', '-', 'gi')), ''),
      NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9]+', '-', 'gi')), ''),
      'player'
    ) AS base_username,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        NULLIF(lower(regexp_replace(display_name, '[^a-z0-9]+', '-', 'gi')), ''),
        NULLIF(lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9]+', '-', 'gi')), ''),
        'player'
      )
      ORDER BY created_at, id
    ) AS base_rank
  FROM users
),
resolved_usernames AS (
  SELECT
    id,
    CASE
      WHEN base_rank = 1 THEN base_username
      ELSE base_username || '-' || base_rank::text
    END AS username
  FROM base_usernames
)
UPDATE users u
SET username = r.username
FROM resolved_usernames r
WHERE u.id = r.id
  AND (u.username IS NULL OR u.username = '');

ALTER TABLE users
  DROP COLUMN IF EXISTS muxed_id;

DROP INDEX IF EXISTS users_muxed_id_unique;

ALTER TABLE game_sessions
  DROP CONSTRAINT IF EXISTS game_sessions_status_check;

ALTER TABLE game_sessions
  ADD CONSTRAINT game_sessions_status_check
    CHECK (status IN ('warmup', 'active', 'completed', 'flagged', 'abandoned'));
