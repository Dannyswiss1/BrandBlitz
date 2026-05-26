import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `chk_constraint_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

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

describeIntegration("challenges.ends_at > starts_at constraint", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;
  let brandId: string;

  beforeAll(async () => {
    const db = await import("../index");
    query = db.query;
    closeDb = db.closeDb;

    await query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await query(`
      CREATE TABLE users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL
      )
    `);

    await query(`
      CREATE TABLE brands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      )
    `);

    await query(`
      CREATE TABLE challenges (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id     UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        challenge_id TEXT NOT NULL UNIQUE,
        pool_amount_stroops BIGINT NOT NULL DEFAULT 0,
        starts_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at      TIMESTAMPTZ,
        CONSTRAINT challenges_ends_after_starts CHECK (ends_at IS NULL OR ends_at > starts_at)
      )
    `);

    const userResult = await query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`constraint-test-${randomUUID()}@example.test`, "Constraint Tester"]
    );
    const userId = userResult.rows[0].id;

    const brandResult = await query<{ id: string }>(
      `INSERT INTO brands (owner_user_id, name) VALUES ($1, $2) RETURNING id`,
      [userId, "Test Brand"]
    );
    brandId = brandResult.rows[0].id;
  });

  afterAll(async () => {
    if (query) await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (closeDb) await closeDb();
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("allows ends_at to be NULL", async () => {
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops)
         VALUES ($1, $2, 100)`,
        [brandId, `null-ends-${randomUUID()}`]
      )
    ).resolves.toBeDefined();
  });

  it("allows ends_at strictly after starts_at", async () => {
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops, ends_at)
         VALUES ($1, $2, 100, NOW() + INTERVAL '1 hour')`,
        [brandId, `valid-ends-${randomUUID()}`]
      )
    ).resolves.toBeDefined();
  });

  it("rejects ends_at equal to starts_at (check_violation 23514)", async () => {
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops, starts_at, ends_at)
         VALUES ($1, $2, 100, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [brandId, `eq-ends-${randomUUID()}`]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects ends_at before starts_at (check_violation 23514)", async () => {
    await expect(
      query(
        `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops, starts_at, ends_at)
         VALUES ($1, $2, 100, '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [brandId, `past-ends-${randomUUID()}`]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });
});
