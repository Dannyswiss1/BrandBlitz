# Database Schema Reference

## game_sessions

Tracks a single user's participation in one challenge.

### Timestamps

| Column                 | Meaning                                |
| ---------------------- | -------------------------------------- |
| `created_at`           | Row inserted (session created)         |
| `warmup_started_at`    | User entered warmup phase              |
| `warmup_completed_at`  | User passed warmup gate                |
| `challenge_started_at` | First question delivered               |
| `completed_at`         | All rounds answered; session finalised |

`completed_at` is the **canonical end timestamp**. It is set by `finishSession()` and used as the tiebreaker in leaderboard ordering (`total_score DESC, completed_at ASC` — fastest finisher wins ties).

> `challenge_ended_at` was removed in migration `002_drop_challenge_ended_at.sql`. Any code or query referencing that column must be updated to use `completed_at`.

### Status lifecycle

```
warmup → active → completed
                ↘ flagged
```

## users

### muxed_id uniqueness

`users.muxed_id` is nullable because most users do not have a muxed Stellar ID. Non-null values must still be unique, enforced by the partial unique index:

```sql
CREATE UNIQUE INDEX users_muxed_id_unique
  ON users (muxed_id)
  WHERE muxed_id IS NOT NULL;
```

This preserves the intended semantics while keeping NULL-only rows out of the uniqueness index. Equality lookups such as `WHERE muxed_id = $1` can use the partial index because the predicate implies `muxed_id IS NOT NULL`.

### wallet fields

`users.embedded_wallet_address` is present in the canonical schema alongside `stellar_address`. Application code treats it as the preferred payout wallet when populated, falling back to `stellar_address` otherwise.

## challenges

### deposit_memo lookup

`deposit_memo` carries the Stellar payment memo that identifies which challenge a deposit belongs to. It has a `UNIQUE` constraint (backed by a btree index) and an additional explicit index `idx_challenges_deposit_memo` (see `docs/database/indexes.md`).

`getChallengeByMemo()` in `apps/api/src/db/queries/challenges.ts` is the hot path for webhook-time deposit matching.

### `challenges_ends_after_starts` constraint

```sql
CONSTRAINT challenges_ends_after_starts CHECK (ends_at IS NULL OR ends_at > starts_at)
```

A challenge with a defined end date must end strictly after it starts. `NULL` `ends_at` is allowed (open-ended challenge). Inserting or updating a row with `ends_at <= starts_at` raises PostgreSQL error `23514` (check_violation).

**Migration:** `migrations/009_challenges_end_after_start.sql` adds this constraint to existing databases and backfills any violating rows by setting `ends_at = starts_at + INTERVAL '72 hours'`.

## app_config

Runtime-tunable key/value store added in `migrations/010_app_config.sql`.

| key                     | default value                                                    | description                                                              |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `anti_cheat.thresholds` | `{"min_human_reaction_ms": 150, "max_human_reaction_ms": 30000}` | Anti-cheat reaction-time window. Tunable via `PATCH /admin/config/:key`. |

## audit_log

Append-only table. Every change made through `PATCH /admin/config/:key` inserts a row recording the actor, the old value, and the new value. Rows are never deleted.
