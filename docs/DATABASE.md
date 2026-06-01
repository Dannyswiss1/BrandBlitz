# Database Reference

This document explains the canonical BrandBlitz schema, the current table relationships, and the ownership rules used by contributors and auditors.

![Database ER Diagram](./db/er.svg)

## Overview

- `init.sql` is a bootstrap script for fresh PostgreSQL instances.
- `apps/api/migrations/00000-initial.sql` is the baseline schema snapshot.
- `apps/api/migrations/` contains forward migrations plus optional rollback files.
- `docs/db/er.svg` is auto-generated from the live schema.
- `pnpm docs:db` regenerates the ER diagram from `DATABASE_URL` or the default local dev database.
- CI validates that `docs/db/er.svg` is fresh for each change to `init.sql`, the API migrations, or docs.

## Conventions

- Every table includes `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` and `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`.
- A shared trigger function updates `updated_at` on every row change.
- `init.sql` should remain a thin bootstrap wrapper.
- `apps/api/migrations/` should be the source of truth for schema evolution.

## Domain ownership

| Table                  | Ownership             |
| ---------------------- | --------------------- |
| `users`                | identity / auth       |
| `brands`               | brand management      |
| `challenges`           | challenge lifecycle   |
| `challenge_questions`  | challenge content     |
| `game_sessions`        | gameplay state        |
| `session_round_scores` | gameplay scoring      |
| `payouts`              | settlement / finance  |
| `fraud_flags`          | anti-cheat / risk     |
| `league_assignments`   | ranking / leaderboard |
| `user_badges`          | achievements          |
| `referrals`            | growth / referral     |
| `referral_payouts`     | growth / referral     |

## Soft delete and retention

- `brands.deleted_at` is currently the only soft-delete marker in the schema.
- No other table implements application-level soft deletes today.
- There is no schema-level automatic retention policy in this repo; row retention is currently indefinite unless additional cleanup logic is added.

---

## users

- Purpose: player identity, authentication, profile, and leaderboard metadata.
- Key columns
  - `id`: PK
  - `email`: unique
  - `google_id`: unique
  - `username`: unique
  - `phone_hash`: unique
  - `embedded_wallet_address`: optional wallet address used when a user has an embedded wallet instead of a Stellar address
  - `referral_code`: unique 6-character invite code
  - `role`: `player` / `brand` / `admin`
  - `league`: enforced to `bronze`, `silver`, or `gold`
  - `total_score`, `total_earned_usdc`, `challenges_played`
- Indexes
  - `idx_users_email`
  - `idx_users_google_id`
  - `idx_users_phone_hash`
  - `idx_users_total_score`
  - `idx_users_league`
- FK semantics: none.
- Soft delete: none.
- Retention: indefinite; retains user account and scoring history.
- Domain owner: identity / auth.

## brands

- Purpose: brand metadata and ownership for challenge creation.
- Key columns
  - `id`: PK
  - `owner_user_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `name`, `tagline`, `brand_story`, brand image URLs
  - `deleted_at`: soft-delete marker
- Indexes
  - `idx_brands_owner_user_id`
  - `idx_brands_deleted_at`
- FK semantics: brand owner is removed when the owning user is deleted.
- Soft delete: `deleted_at` indicates a removed brand without deleting rows.
- Retention: soft-deleted brands remain in the database until manual purge.
- Domain owner: brand management.

## challenges

- Purpose: challenge lifecycle, deposit tracking, and payout state.
- Key columns
  - `id`: PK
  - `brand_id`: FK to `brands(id)` with `ON DELETE CASCADE`
  - `challenge_id`: unique external identifier
  - `status`: enum including `pending_deposit`, `active`, `ended`, `settled`, `payout_failed`, `cancelled`
  - `pool_amount_usdc`, deposit metadata, `participant_count`
  - `deposit_memo`: unique
  - `deposit_tx_hash`: unique
- Indexes
  - `idx_challenges_brand_id`
  - `idx_challenges_status`
  - `idx_challenges_ends_at`
  - `idx_challenges_challenge_id`
  - `idx_challenges_deposit_memo`
- FK semantics: challenges are removed when the owning brand is deleted.
- Soft delete: none.
- Retention: retains challenge history and deposit state permanently.
- Domain owner: challenge lifecycle.

## challenge_questions

- Purpose: server-side challenge question storage.
- Key columns
  - `id`: PK
  - `challenge_id`: FK to `challenges(id)` with `ON DELETE CASCADE`
  - `round`: `1`, `2`, or `3`
  - `question_type`, `prompt_type`, `question_text`
  - `option_a` .. `option_d`, `correct_option`
- Indexes
  - `idx_challenge_questions_challenge`
- Constraints
  - `UNIQUE (challenge_id, round)` ensures exactly one question per challenge round.
- FK semantics: questions are removed when their challenge is removed.
- Soft delete: none.
- Retention: retains questions linked to published challenges.
- Domain owner: challenge content.

## game_sessions

- Purpose: records gameplay progress for each participant in a challenge.
- Key columns
  - `id`: PK
  - `user_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `challenge_id`: FK to `challenges(id)` with `ON DELETE CASCADE`
  - `status`: enum `warmup`, `active`, `completed`, `flagged`
  - `device_id`, `ip_address`, timing and score fields for each round
  - `total_score`, `rank`, `flagged`, `flag_reasons`, `fraud_flags`
- Indexes
  - `idx_game_sessions_challenge_id`
  - `idx_game_sessions_user_id`
  - `idx_game_sessions_status`
  - `idx_game_sessions_total_score` (`challenge_id`, `total_score DESC NULLS LAST`) for leaderboard ordering
- Constraints
  - `UNIQUE (user_id, challenge_id)` prevents duplicate sessions for the same user and challenge.
- FK semantics: sessions are removed if either the user or challenge is deleted.
- Soft delete: none.
- Retention: session history is retained; completed scores are used for leaderboard ordering.
- Domain owner: gameplay state.

## session_round_scores

- Purpose: store per-round scores for a session.
- Key columns
  - `id`: PK
  - `session_id`: FK to `game_sessions(id)` with `ON DELETE CASCADE`
  - `round`: `1`, `2`, or `3`
  - `score`
- Constraints
  - `UNIQUE (session_id, round)` ensures one score record per round.
- Indexes
  - `idx_session_round_scores_session_id`
- FK semantics: score rows are removed when the parent session is deleted.
- Soft delete: none.
- Retention: matched to the lifetime of `game_sessions`.
- Domain owner: gameplay scoring.

## payouts

- Purpose: track settled and pending payouts to winners.
- Key columns
  - `id`: PK
  - `challenge_id`: FK to `challenges(id)` with `ON DELETE CASCADE`
  - `user_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `session_id`: FK to `game_sessions(id)` with `ON DELETE CASCADE`
  - `amount_usdc`, `status`, `tx_hash`, `error_message`
- Constraints
  - `UNIQUE (challenge_id, user_id)` prevents duplicate payout rows for the same challenge and user.
- Indexes
  - `idx_payouts_challenge_id`
  - `idx_payouts_user_id`
  - `idx_payouts_status`
- FK semantics: payouts are removed when the related challenge, user, or session is removed.
- Soft delete: none.
- Retention: payout records are retained for audit and reconciliation.
- Domain owner: settlement / finance.

## fraud_flags

- Purpose: anti-cheat flags aggregated per session.
- Key columns
  - `id`: PK
  - `session_id`: FK to `game_sessions(id)` with `ON DELETE CASCADE`
  - `user_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `flag_type`: type of fraud flag
  - `details`: JSONB with additional metadata
- Constraints
  - `UNIQUE (session_id, flag_type)` enforces one flag type per session.
- Indexes
  - `idx_fraud_flags_user_id`
  - `idx_fraud_flags_session_id`
- FK semantics: flags are removed when the session or user is deleted.
- Soft delete: none.
- Retention: retains fraud state as long as the session data exists.
- Domain owner: anti-cheat / risk.

## league_assignments

- Purpose: weekly ranking and promotion/demotion state.
- Key columns
  - `id`: PK
  - `user_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `league`: `bronze` / `silver` / `gold`
  - `group_id`, `week_start`, `weekly_points`
  - `promoted`, `demoted`
- Constraints
  - `UNIQUE (user_id, week_start)` ensures one assignment per user per week.
- Indexes
  - `idx_league_assignments_week`
- FK semantics: assignments are removed when the user is removed.
- Soft delete: none.
- Retention: weekly league history is retained indefinitely.
- Domain owner: ranking / leaderboard.

## user_badges

- Purpose: track achievement badges awarded to users.
- Key columns
  - `id`: PK
  - `user_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `badge_slug`
  - `awarded_at`
- Constraints
  - `UNIQUE (user_id, badge_slug)` prevents duplicate badges.
- Indexes
  - `idx_user_badges_user_id`
- FK semantics: badges are removed when the user is removed.
- Soft delete: none.
- Retention: achievement history is retained indefinitely.
- Domain owner: gamification.

## referrals

- Purpose: record referral relationships and reward state.
- Key columns
  - `id`: PK
  - `referrer_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `referred_id`: FK to `users(id)` with `ON DELETE CASCADE`
  - `rewarded`
- Constraints
  - `UNIQUE (referred_id)` ensures each referred user is linked to exactly one referrer.
- Indexes
  - `idx_referrals_referrer_id`
- FK semantics: referral rows are removed if either user is deleted.
- Soft delete: none.
- Retention: referral history is retained indefinitely.
- Domain owner: growth / referral.

## referral_payouts

- Purpose: track referral bonus payouts for both the referrer and the referred user.
- Key columns
  - `id`: PK
  - `referral_id`: FK to `referrals(id)` with `ON DELETE CASCADE`
  - `challenge_id`: optional FK to `challenges(id)` for bonus attribution
  - `referrer_id`, `referred_id`
  - `referrer_amount_stroops`, `referred_amount_stroops`
  - `status`: `pending`, `sent`, or `failed`
- Constraints
  - `UNIQUE (referral_id)` ensures each referral earns at most one bonus payout row.
- Indexes
  - `idx_referral_payouts_referrer_id`
  - `idx_referral_payouts_referred_id`
  - `idx_referral_payouts_status`
- FK semantics: rows are removed if the underlying referral or users are deleted.
- Retention: referral bonus history is retained indefinitely.
- Domain owner: growth / referral.

## refunds

- Purpose: records one admin-triggered refund per challenge for audit and reconciliation.
- Key columns
  - `id`: PK
  - `challenge_id`: unique FK to `challenges(id)` with `ON DELETE CASCADE`
  - `admin_id`: admin user that initiated the refund
  - `reason`: operator-entered refund reason
  - `amount_stroops`: refunded USDC stroop amount
  - `destination`: Stellar account that received the refund
  - `tx_hash`: unique refund transaction hash
- Soft delete: not implemented.
- Retention: append-only for audit and reconciliation.

## audit_log

- Purpose: an append-only audit trail is not currently defined in the repository schema.
- Expected semantics: store immutable action records for security and compliance.
- Soft delete: not applicable; audit logs should remain immutable.
- Retention: can be governed by policy, but the schema should preserve history first.

## legal_documents

- Purpose: legal document metadata is not currently defined in the repository schema.
- Expected semantics: store legal version information, titles, and signed status requirements.
- Domain owner: compliance.
- Soft delete: not implemented.

## user_legal_acceptances

- Purpose: acceptance records for legal documents are not currently defined in the repository schema.
- Expected semantics: link users to accepted legal versions with timestamps.
- Domain owner: compliance.
- Soft delete: none; acceptance history should be retained.

## archive tables

- Purpose: archive tables are not currently present in this schema.
- Expected usage: store historical or deleted rows outside the primary transactional tables.
- Recommended semantics: preserve original row data, timestamps, and provenance.
- Soft delete / retention: archive tables usually exist to preserve data after live purge.

---

## Regenerating the ER diagram

Run from the repository root:

```bash
pnpm docs:db
```

If `DATABASE_URL` is unset, the script defaults to the local development DB at:

```bash
postgresql://brandblitz:brandblitz_dev@127.0.0.1:5432/brandblitz?sslmode=disable
```

CI asserts that the generated diagram matches `docs/db/er.svg`.
