# Database Migration Strategy

## Strategy A — init.sql is the canonical current state

`init.sql` always reflects the **complete, up-to-date schema** for a fresh database.  
Migrations under `migrations/` are **deltas for existing databases only**.

### Rules

| Scenario | What to run |
|---|---|
| Fresh install / CI from scratch | `init.sql` only |
| Existing database upgrade | Only the new migration file(s) |

Never run migrations on a fresh database that was just seeded from `init.sql` — they would attempt to add columns or drop constraints that are already in the correct state.

### Stop-gap: `IF NOT EXISTS` / `IF EXISTS`

Every migration MUST use safe DDL guards so it is idempotent:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash TEXT UNIQUE;
ALTER TABLE game_sessions DROP COLUMN IF EXISTS challenge_ended_at;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_challenges_deposit_memo ON challenges (deposit_memo);
```

This protects against the case where a migration is accidentally replayed against a database that was already seeded from a newer `init.sql`.

### Migration inventory

| File | Description |
|---|---|
| `001_phone_storage_schema.sql` | Adds `phone_hash` / `phone_verified_at` to `users`; drops legacy `phone_number` |
| `002_drop_challenge_ended_at.sql` | Backfills `completed_at` from `challenge_ended_at`, then drops the redundant column |
| `003_explicit_deposit_memo_index.sql` | Adds explicit btree index `idx_challenges_deposit_memo` on `challenges.deposit_memo` |
| `011_pool_amount_stroops.sql` | Stores challenge pool and payout amounts as integer USDC stroops |

### CI validation (dual-path)

The workflow `.github/workflows/db-dual-path.yml` spins up two Postgres containers and asserts that both paths converge to the same schema:

1. **Fresh path** — runs `init.sql` only
2. **Migration path** — runs an older baseline then applies all migrations in order

Both paths are then diffed with `pg_dump --schema-only`; the workflow fails if they diverge.
