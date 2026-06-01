# Contributing to BrandBlitz

Thank you for contributing to BrandBlitz — the skill-validated attention marketplace built on Stellar.

---

## Table of Contents

- [Branch Naming](#branch-naming)
- [Commit Format](#commit-format)
- [Pull Request Guidelines](#pull-request-guidelines)
- [PR Title Lint](#pr-title-lint)
- [Code Review Expectations](#code-review-expectations)
- [Drips Wave 4 Rules](#drips-wave-4-rules)
- [Issue Templates](#issue-templates)
- [Operations Runbooks](#operations-runbooks)
- [Getting Started](#getting-started)

---

## Branch Naming

All branches must follow this pattern:

```
<type>/issue-<N>-<short-description>
```

| Type | When to use |
|---|---|
| `feat` | New feature or user-facing behaviour |
| `fix` | Bug fix |
| `test` | Adding or updating tests only |
| `refactor` | Code change that neither adds a feature nor fixes a bug |
| `chore` | Tooling, dependencies, build scripts |
| `docs` | Documentation only |

**Examples**

```bash
feat/issue-42-challenge-leaderboard
fix/issue-13-n-plus-one-leaderboard-query
test/issue-23-rate-limit-middleware
docs/issue-55-contributing-guide
chore/issue-67-upgrade-stellar-sdk
```

Branches that do not match this pattern will fail the branch-name check in CI.

---

## Commit Format

BrandBlitz uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

- **type** — one of: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`, `perf`, `ci`
- **scope** — optional, the affected package or layer: `api`, `web`, `stellar`, `storage`, `contracts`, `worker`
- **summary** — present tense, lowercase, no trailing period, under 72 characters
- **body** — wrap at 100 characters; explain *why*, not *what*
- **footer** — `Closes #N` or `Fixes #N` to auto-close the linked issue

**Examples**

```
feat(api): add getTopSessionsPerChallenge to eliminate leaderboard N+1 query

Closes #13
```

```
fix(web): validate MIME type and file size before presigning upload

Fixes #49
```

```
test(api): cover all rate-limit policies, key derivation, and Redis fail-open

Closes #23
```

Commits that do not follow Conventional Commits will fail the commit-message lint hook.

---

## Pull Request Guidelines

1. **One issue per PR.** Keep PRs focused — reviewers review faster, CI fails more precisely.
2. **Link the issue.** Include `Closes #N` (or `Fixes #N`) in the PR description body so the issue auto-closes on merge.
3. **Tests are required.** Every feature or bug fix must include tests. PRs that drop overall coverage below the current baseline will be blocked.
4. **Type-check must pass.** Run `pnpm type-check` locally before pushing.
5. **Lint must pass.** Run `pnpm lint` locally. The CI gate rejects any ESLint errors.
6. **No `console.log` in production code.** Use the structured logger (`apps/api/src/lib/logger.ts`) in the API, and `console.error` only for unrecoverable startup errors.
7. **Keep `.env.example` in sync.** If you add a new environment variable, add it to `.env.example` with an inline comment and update the table in `README.md`.

### PR Description Template

```markdown
## What

Short description of the change.

## Why

Motivation or the problem being solved.

## How

Approach taken, notable design decisions, alternatives rejected.

## Test plan

- [ ] Unit tests added / updated
- [ ] Manual smoke test: describe what you clicked/ran

## Checklist

- [ ] `pnpm type-check` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `.env.example` updated (if new env vars added)

Closes #N
```

---

## PR Title Lint

PR titles are linted against the Conventional Commits format by the CI pipeline (see issue [#57](../../issues/57)).

The title **must** match:

```
<type>(<optional-scope>): <summary>
```

**Valid**

```
feat(api): add global leaderboard endpoint with Redis cache
fix(web): prevent double-submit on challenge answer
test(api): unit tests for rate-limit middleware
docs: add CONTRIBUTING guide and fix README env vars
```

**Invalid** — these will fail CI

```
Updated the leaderboard            ← no type prefix
feat: Updated the leaderboard      ← uppercase U, no scope (scope is optional but summary must be lowercase)
WIP: fixing stuff                  ← not a valid type
```

---

## Code Review Expectations

### For authors

- Respond to all review comments before requesting re-review.
- Mark threads as resolved only after the reviewer's concern is addressed in code.
- Keep the PR up to date with `main` — rebase, don't merge.

### For reviewers

- Review within **2 business days** of assignment.
- Use GitHub's suggestion feature for minor one-line fixes — it saves a round-trip.
- Distinguish blocking concerns from non-blocking nits:
  - **Blocking** — correctness, security, missing tests, API contract breakage
  - **Nit** — style preferences that don't affect correctness (prefix with `nit:`)
- Approve once all blocking concerns are addressed. Do not block on unresolved nits.

### Merge criteria

A PR may be merged when it has:
1. At least **1 approving review** from a maintainer
2. All CI checks green (type-check, lint, tests, PR title lint)
3. No unresolved blocking comments

Maintainers may merge with a single approval for documentation-only changes.

---

## Drips Wave Participation Rules

BrandBlitz is built as part of the [Drips programme](https://drips.network). The following rules apply to all Drips Wave contributions in this repository:

1. **All Stellar integrations must run on testnet during development.** Set `STELLAR_NETWORK=testnet` in your `.env`. Never commit mainnet credentials.
2. **Every PR that touches Stellar code must include a testnet transaction hash** in the PR description demonstrating the happy path works end-to-end. Use the `stellar-cli` or Stellar Laboratory to verify.
3. **Payments are real even on testnet.** Use the testnet faucet (`friendbot`) to fund test wallets. Never use real USDC for local testing.
4. **Smart contract changes require a separate PR.** Changes to `contracts/escrow/` must be reviewed by at least two maintainers and include both `cargo test` and `soroban-cli` deploy output.
5. **Batch payouts must not exceed 50 ops per transaction.** The `MAX_OPS_PER_TX = 50` constant in `packages/stellar/src/constants.ts` is a hard limit — Stellar rejects transactions above this.
6. **Do not change the escrow contract interface without a migration plan.** Breaking changes to `settle()` or `refund()` affect live brand deposits.
7. **Drips Wave submission deadline.** All PRs intended for the current Wave submission must be merged to `main` before the freeze date communicated in the project Discord. PRs open after the freeze are automatically queued for the next Wave.

---

## Issue Templates

Use the appropriate issue template when opening a new issue (see issue [#60](../../issues/60)):

| Template | When to use |
|---|---|
| **Bug report** | Something that was working and now isn't, or produces incorrect output |
| **Feature request** | New functionality or a change to existing behaviour |
| **Test coverage** | A module that lacks tests; specify the file and target coverage % |
| **Documentation** | Incorrect, outdated, or missing docs |
| **Chore / maintenance** | Dependency upgrades, tooling changes, CI fixes |

If no template fits, open a blank issue with at minimum: context, expected behaviour, and actual behaviour.

---

## Operations Runbooks

When you introduce a new failure mode (new queue, new external dependency, new background job), add a runbook in [`docs/runbooks/`](./docs/runbooks/README.md) following the template in the index.

Runbooks cover: symptom → impact → diagnosis → mitigation → remediation.
Link your new runbook from the `docs/runbooks/README.md` index.

---

## Getting Started

```bash
# 1. Fork and clone
git clone https://github.com/<your-fork>/brandblitz.git
cd brandblitz

# 2. Install dependencies
pnpm install

# 3. Copy and configure environment
cp .env.example .env
# Fill in JWT_SECRET, NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
# STELLAR_HOT_WALLET_SECRET, and PHONE_HASH_SALT at minimum.

# 4. Start infrastructure
docker compose up postgres redis minio minio-setup

# 4b. (Optional) Seed the database with fixture data — 50 users, 3 brands, 6 challenges, 200 sessions
pnpm --filter @brandblitz/api seed
# Re-run with --reset to wipe and re-seed from scratch:
# pnpm --filter @brandblitz/api seed -- --reset
# Or use SEED_DEV=1 to auto-seed on docker compose up (see docker-compose.override.yml)

# 5. Start all apps (Turborepo parallel)
pnpm dev

# 6. Verify
curl http://localhost:3001/health     # {"status":"ok"}
open http://localhost:3000            # Next.js frontend

# 7. Run tests
pnpm test
pnpm type-check
pnpm lint
```

### Common Issues

| Symptom | Fix |
|---|---|
| `Error: STELLAR_HOT_WALLET_SECRET required` | Set `STELLAR_HOT_WALLET_SECRET=SA...` in `.env`. Generate a testnet keypair with `stellar-cli keys generate`. |
| S3 uploads fail locally | Ensure MinIO is running (`docker compose up minio minio-setup`) and `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` match `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` in `.env`. |
| `OZ_FACILITATOR_API_KEY required` | Required only for CareGuard services. Not needed for BrandBlitz. |
| PostgreSQL connection refused | Run `docker compose up postgres` and check `DATABASE_URL` points to `localhost:5432`. |
| `pnpm: command not found` | Install with `npm install -g pnpm@10.33.0`. |
| NextAuth `NEXTAUTH_SECRET` error | Set `NEXTAUTH_SECRET` (same value as `JWT_SECRET` is fine for local dev). |

For questions, open a GitHub Discussion or ask in the project Discord.
