/**
 * Integration tests for issue #103: FK ON DELETE behaviour after migration 012.
 * Verifies:
 *  - hard-deleting a user sets game_sessions.user_id and payouts.user_id to NULL
 *  - hard-deleting a user with open fraud_flags is rejected (RESTRICT)
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `users_fk_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existing = url.searchParams.get("options");
  const opt = `-c search_path=${schema}`;
  url.searchParams.set("options", existing ? `${existing} ${opt}` : opt);
  return url.toString();
}

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = withSearchPath(originalDatabaseUrl, schemaName);
}

const describeIntegration = originalDatabaseUrl ? describe : describe.skip;

describeIntegration("FK ON DELETE behaviour (migration 012)", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;

  async function insertUser(): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1, 'Test') RETURNING id`,
      [`u-${randomUUID()}@test.invalid`]
    );
    return r.rows[0].id;
  }

  async function insertChallenge(brandId: string): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO challenges (brand_id, challenge_id) VALUES ($1, $2) RETURNING id`,
      [brandId, `ch-${randomUUID()}`]
    );
    return r.rows[0].id;
  }

  async function insertBrand(ownerId: string): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO brands (owner_user_id, name) VALUES ($1, 'B') RETURNING id`,
      [ownerId]
    );
    return r.rows[0].id;
  }

  beforeAll(async () => {
    const db = await import("../index");
    query = db.query;
    closeDb = db.closeDb;

    await query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // Minimal schema matching init.sql + migration 012 FK changes
    await query(`
      CREATE TABLE users (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email        TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL
      )
    `);

    await query(`
      CREATE TABLE brands (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL
      )
    `);

    await query(`
      CREATE TABLE challenges (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id         UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        challenge_id     TEXT NOT NULL UNIQUE,
        pool_amount_stroops BIGINT NOT NULL DEFAULT 0,
        status           TEXT NOT NULL DEFAULT 'pending_deposit'
      )
    `);

    // game_sessions: user_id nullable + SET NULL (migration 012)
    await query(`
      CREATE TABLE game_sessions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        total_score  INTEGER NOT NULL DEFAULT 0
      )
    `);

    // payouts: user_id nullable + SET NULL (migration 012)
    await query(`
      CREATE TABLE payouts (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        amount_stroops BIGINT NOT NULL DEFAULT 100
      )
    `);

    // fraud_flags: user_id NOT NULL + RESTRICT (migration 012)
    await query(`
      CREATE TABLE fraud_flags (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        flag_type  TEXT NOT NULL
      )
    `);
  });

  afterAll(async () => {
    if (query) await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (closeDb) await closeDb();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("hard-delete user sets game_sessions.user_id to NULL", async () => {
    const userId = await insertUser();
    const brandId = await insertBrand(userId);
    const challengeId = await insertChallenge(brandId);

    const { rows: [session] } = await query<{ id: string }>(
      `INSERT INTO game_sessions (user_id, challenge_id) VALUES ($1, $2) RETURNING id`,
      [userId, challengeId]
    );

    await query("DELETE FROM users WHERE id = $1 /* include_deleted */", [userId]);

    const { rows: [row] } = await query<{ user_id: string | null }>(
      "SELECT user_id FROM game_sessions WHERE id = $1",
      [session.id]
    );
    expect(row.user_id).toBeNull();
  });

  it("hard-delete user sets payouts.user_id to NULL", async () => {
    const userId = await insertUser();
    const brandId = await insertBrand(userId);
    const challengeId = await insertChallenge(brandId);

    const { rows: [payout] } = await query<{ id: string }>(
      `INSERT INTO payouts (challenge_id, user_id) VALUES ($1, $2) RETURNING id`,
      [challengeId, userId]
    );

    await query("DELETE FROM users WHERE id = $1 /* include_deleted */", [userId]);

    const { rows: [row] } = await query<{ user_id: string | null }>(
      "SELECT user_id FROM payouts WHERE id = $1",
      [payout.id]
    );
    expect(row.user_id).toBeNull();
  });

  it("hard-delete user with fraud_flags is rejected (RESTRICT)", async () => {
    const userId = await insertUser();

    await query(
      `INSERT INTO fraud_flags (user_id, flag_type) VALUES ($1, 'test_flag')`,
      [userId]
    );

    await expect(
      query("DELETE FROM users WHERE id = $1 /* include_deleted */", [userId])
    ).rejects.toThrow();
  });
});
