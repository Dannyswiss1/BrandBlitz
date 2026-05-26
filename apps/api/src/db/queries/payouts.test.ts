import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `payouts_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString);
  const existingOptions = url.searchParams.get("options");
  const searchPathOption = `-c search_path=${schema}`;
  url.searchParams.set(
    "options",
    existingOptions ? `${existingOptions} ${searchPathOption}` : searchPathOption
  );
  return url.toString();
}

if (originalDatabaseUrl) {
  process.env.DATABASE_URL = withSearchPath(originalDatabaseUrl, schemaName);
}

const describeIntegration = originalDatabaseUrl ? describe : describe.skip;

describeIntegration("payouts db queries", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;
  let payouts: typeof import("./payouts");

  async function createUser(emailPrefix: string): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`${emailPrefix}-${randomUUID()}@example.test`, emailPrefix]
    );
    return result.rows[0].id;
  }

  async function createBrand(ownerId: string): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO brands (owner_id, name) VALUES ($1, $2) RETURNING id`,
      [ownerId, "Test Brand"]
    );
    return result.rows[0].id;
  }

  async function createChallenge(brandId: string): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO challenges (brand_id, challenge_id, pool_amount_stroops) VALUES ($1, $2, $3) RETURNING id`,
      [brandId, `memo-${randomUUID()}`, "1000000000"]
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    const db = await import("../index");
    query = db.query;
    closeDb = db.closeDb;
    payouts = await import("./payouts");

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
        owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL
      )
    `);

    await query(`
      CREATE TABLE challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        challenge_id TEXT NOT NULL UNIQUE,
        pool_amount_stroops BIGINT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending_deposit'
      )
    `);

    await query(`
      CREATE TABLE payouts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stellar_address TEXT NOT NULL,
        amount_stroops BIGINT NOT NULL DEFAULT 0,
        tx_hash TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });

  afterAll(async () => {
    if (query) {
      await query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    }
    if (closeDb) {
      await closeDb();
    }
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("createPayout persists with default status 'pending' and correct FKs", async () => {
    const userId = await createUser("payout-create");
    const brandId = await createBrand(userId);
    const challengeId = await createChallenge(brandId);
    const amount = "12.3456789";

    const payout = await payouts.createPayout({
      challengeId,
      userId,
      stellarAddress: "GB123...",
      amountUsdc: amount,
    });

    expect(payout.id).toBeTruthy();
    expect(payout.challenge_id).toBe(challengeId);
    expect(payout.user_id).toBe(userId);
    expect(payout.status).toBe("pending");
    expect(payout.amount_usdc).toBe(amount);
    expect(payout.amount_stroops).toBe("123456789");
  });

  it("updatePayoutStatus transitions status correctly with optional txHash", async () => {
    const userId = await createUser("status-trans");
    const brandId = await createBrand(userId);
    const challengeId = await createChallenge(brandId);
    const payout = await payouts.createPayout({
      challengeId,
      userId,
      stellarAddress: "G...",
      amountUsdc: "10.0000000",
    });

    // Pending -> Sent (with txHash)
    await payouts.updatePayoutStatus(payout.id, "sent", "TX_123");
    let updated = (await query<any>("SELECT * FROM payouts WHERE id = $1", [payout.id])).rows[0];
    expect(updated.status).toBe("sent");
    expect(updated.tx_hash).toBe("TX_123");

    // Sent -> Failed (no txHash provided)
    await payouts.updatePayoutStatus(payout.id, "failed");
    updated = (await query<any>("SELECT * FROM payouts WHERE id = $1", [payout.id])).rows[0];
    expect(updated.status).toBe("failed");
    expect(updated.tx_hash).toBe("TX_123"); // should remain
  });

  it("getPendingPayouts returns oldest-first and respects limit", async () => {
    const userId = await createUser("retrieval");
    const brandId = await createBrand(userId);
    const challengeId = await createChallenge(brandId);

    const p1 = await payouts.createPayout({ challengeId, userId, stellarAddress: "A", amountUsdc: "1.0" });
    const p2 = await payouts.createPayout({ challengeId, userId, stellarAddress: "B", amountUsdc: "2.0" });
    const p3 = await payouts.createPayout({ challengeId, userId, stellarAddress: "C", amountUsdc: "3.0" });

    const results = await payouts.getPendingPayouts(challengeId, 2);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(p1.id);
    expect(results[1].id).toBe(p2.id);
  });

  it("Amount precision is preserved (7 decimals) on round-trip", async () => {
    const userId = await createUser("precision");
    const brandId = await createBrand(userId);
    const challengeId = await createChallenge(brandId);
    const preciseAmount = "123.4567890";

    const payout = await payouts.createPayout({ challengeId, userId, stellarAddress: "G", amountUsdc: preciseAmount });
    expect(payout.amount_usdc).toBe(preciseAmount);
    expect(payout.amount_stroops).toBe("1234567890");
  });
});
