-- Safety net: ensure session_round_scores.session_id cascades on delete.
--
-- The archive worker now deletes session_round_scores rows explicitly before
-- their parent game_sessions rows, but future code paths that delete a
-- game_session directly must not be able to leave orphaned round-score rows.
-- This migration is idempotent: it drops any existing FK on session_id and
-- re-creates it with ON DELETE CASCADE.

DO $$
DECLARE
  fk_name TEXT;
BEGIN
  SELECT tc.constraint_name
    INTO fk_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
   WHERE tc.table_name = 'session_round_scores'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'session_id'
   LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE session_round_scores DROP CONSTRAINT %I',
      fk_name
    );
  END IF;

  ALTER TABLE session_round_scores
    ADD CONSTRAINT session_round_scores_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES game_sessions(id) ON DELETE CASCADE;
END $$;
