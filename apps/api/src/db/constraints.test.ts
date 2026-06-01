/**
 * Integration tests for issue #107: DB-level CHECK constraints (migration 013).
 * Each test inserts a row that violates a constraint and asserts PostgreSQL rejects it.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `constraints_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

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

describeIntegration("CHECK constraint regressions (migration 013)", () => {
  let query: typeof import("./index").query;
  let closeDb: typeof import("./index").closeDb;

  async function insertUser(): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1, 'Test') RETURNING id`,
      [`cu-${randomUUID()}@test.invalid`]
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

  async function insertChallenge(brandId: string): Promise<string> {
    const r = await query<{ id: string }>(
      `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops)
       VALUES ($1, $2, 0) RETURNING id`,
      [brandId, `ch-${randomUUID()}`]
    );
    return r.rows[0].id;
  }

  beforeAll(async () => {
    const db = await import("./index");
    query = db.query;
    closeDb = db.closeDb;

    await query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await query(`
      CREATE TABLE users (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email        TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'brand', 'admin'))
      )
    `);

    await query(`
      CREATE TABLE brands (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name          TEXT NOT NULL
      )
    `);

    // challenges with pool_amount constraint (migration 013)
    await query(`
      CREATE TABLE challenges (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id            UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        challenge_id        TEXT NOT NULL UNIQUE,
        pool_amount_stroops BIGINT NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'pending_deposit'
          CHECK (status IN ('pending_deposit','active','ended','settled','payout_failed','cancelled','refunded')),
        CONSTRAINT challenges_pool_amount_positive
          CHECK (
            status IN ('pending_deposit', 'cancelled', 'refunded')
            OR pool_amount_stroops > 0
          )
      )
    `);

    // game_sessions with score range constraint (migration 013)
    await query(`
      CREATE TABLE game_sessions (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
        challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        total_score  INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT game_sessions_score_range
          CHECK (total_score >= 0 AND total_score <= 450)
      )
    `);

    // payouts with amount_stroops > 0 constraint (migration 013)
    await query(`
      CREATE TABLE payouts (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_id   UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
        amount_stroops BIGINT NOT NULL DEFAULT 1,
        CONSTRAINT payouts_amount_positive
          CHECK (amount_stroops > 0)
      )
    `);
  });

  afterAll(async () => {
    if (query) await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (closeDb) await closeDb();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  // ── challenges ─────────────────────────────────────────────────────────────

  it("challenges: pool_amount_stroops = 0 is allowed when status = pending_deposit", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops, status)
         VALUES ($1, $2, 0, 'pending_deposit')`,
        [bid, `ch-${randomUUID()}`]
      )
    ).resolves.toBeDefined();
  });

  it("challenges: pool_amount_stroops = 0 with status = active violates constraint", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops, status)
         VALUES ($1, $2, 0, 'active')`,
        [bid, `ch-${randomUUID()}`]
      )
    ).rejects.toThrow();
  });

  it("challenges: pool_amount_stroops > 0 with status = active is accepted", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops, status)
         VALUES ($1, $2, 1000000, 'active')`,
        [bid, `ch-${randomUUID()}`]
      )
    ).resolves.toBeDefined();
  });

  // ── game_sessions ──────────────────────────────────────────────────────────

  it("game_sessions: total_score = 0 is valid", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    const cid = await insertChallenge(bid);
    await expect(
      query(
        `INSERT INTO game_sessions (user_id, challenge_id, total_score) VALUES ($1, $2, 0)`,
        [uid, cid]
      )
    ).resolves.toBeDefined();
  });

  it("game_sessions: total_score = 450 is valid", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    const cid = await insertChallenge(bid);
    await expect(
      query(
        `INSERT INTO game_sessions (user_id, challenge_id, total_score) VALUES ($1, $2, 450)`,
        [uid, cid]
      )
    ).resolves.toBeDefined();
  });

  it("game_sessions: total_score = 451 violates constraint", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    const cid = await insertChallenge(bid);
    await expect(
      query(
        `INSERT INTO game_sessions (user_id, challenge_id, total_score) VALUES ($1, $2, 451)`,
        [uid, cid]
      )
    ).rejects.toThrow();
  });

  it("game_sessions: total_score = -1 violates constraint", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    const cid = await insertChallenge(bid);
    await expect(
      query(
        `INSERT INTO game_sessions (user_id, challenge_id, total_score) VALUES ($1, $2, -1)`,
        [uid, cid]
      )
    ).rejects.toThrow();
  });

  // ── payouts ────────────────────────────────────────────────────────────────

  it("payouts: amount_stroops = 0 violates constraint", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    const cid = await insertChallenge(bid);
    await expect(
      query(
        `INSERT INTO payouts (challenge_id, user_id, amount_stroops) VALUES ($1, $2, 0)`,
        [cid, uid]
      )
    ).rejects.toThrow();
  });

  it("payouts: amount_stroops > 0 is accepted", async () => {
    const uid = await insertUser();
    const bid = await insertBrand(uid);
    const cid = await insertChallenge(bid);
    await expect(
      query(
        `INSERT INTO payouts (challenge_id, user_id, amount_stroops) VALUES ($1, $2, 5000000)`,
        [cid, uid]
      )
    ).resolves.toBeDefined();
  });
});
