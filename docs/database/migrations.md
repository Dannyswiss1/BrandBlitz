# Database Migration Strategy

## Current strategy

`init.sql` is now a bootstrap script. It includes the baseline schema at
`apps/api/migrations/00000-initial.sql` and then applies the forward migration
files under `apps/api/migrations/`.

### Rules

| Scenario | What to run |
|---|---|
| Fresh install / CI from scratch | `psql -f init.sql` |
| Existing database upgrade | `pnpm --filter @brandblitz/api migrate` |
| Migration verification in CI | `pnpm --filter @brandblitz/api migrate:dryrun` |

### Migration files

| File | Description |
|---|---|
| `00000-initial.sql` | Baseline snapshot of the current schema |
| `00001-hot-path-indexes.sql` | Adds the challenge, leaderboard, and payout indexes |
| `00001-hot-path-indexes.down.sql` | Rolls back the hot-path indexes safely |

### Operational notes

- The migration runner serializes execution with a `SELECT ... FOR UPDATE`
  lock row before applying DDL.
- Safe migrations can include a matching `*.down.sql` rollback file.
- The runner runs `ANALYZE` after applying or rolling back migrations so the
  planner refreshes statistics immediately.
- `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS` are used where possible
  so replays are safe on already-upgraded databases.

### CI validation (dual-path)

The workflow `.github/workflows/db-dual-path.yml` now checks two paths:

1. **Fresh path** - runs `init.sql`
2. **Migration path** - seeds `00000-initial.sql` and then applies the forward
   migrations in `apps/api/migrations/`

Both paths are diffed with `pg_dump --schema-only`; the workflow fails if they
diverge.
