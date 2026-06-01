-- Migration 012: Drop redundant correct_answer column
-- Issue #208: challenge_questions has both correct_answer and correct_option
--
-- Problem: The table defines both correct_answer (string) and correct_option (A-D).
-- Code only references correct_option. The redundant column is dead weight that
-- confuses maintainers and can drift if a question gets edited.
--
-- Solution: Drop correct_answer column, keep only correct_option.

-- Drop the redundant correct_answer column
ALTER TABLE challenge_questions DROP COLUMN IF EXISTS correct_answer;

-- Add comment for documentation
COMMENT ON COLUMN challenge_questions.correct_option IS 
  'The correct answer option (A, B, C, or D). This is the single source of truth for scoring.';

