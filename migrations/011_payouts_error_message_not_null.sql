-- Migration 011: make payouts.error_message NOT NULL with default ''
-- and add a CHECK constraint that enforces every failed payout row to carry
-- a non-empty message so forensics never rely solely on log rotation.

-- Step 1: fill any existing NULLs so the NOT NULL constraint can be applied.
UPDATE payouts SET error_message = '' WHERE error_message IS NULL;

-- Step 2: make the column NOT NULL with an empty-string default.
ALTER TABLE payouts
  ALTER COLUMN error_message SET NOT NULL,
  ALTER COLUMN error_message SET DEFAULT '';

-- Step 3: enforce that failed rows always carry a message and non-failed
-- rows always have an empty message (bijection: status='failed' ↔ message≠'').
ALTER TABLE payouts
  ADD CONSTRAINT payouts_failed_requires_message
    CHECK (
      (status = 'failed') = (LENGTH(error_message) > 0)
    );
