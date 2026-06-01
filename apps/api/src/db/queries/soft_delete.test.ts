process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://brandblitz:brandblitz_dev@localhost:5432/brandblitz";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_SECRET = "test-secret-32-chars-long-minimal-requirement";
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.WEB_URL = "http://localhost:3000";
process.env.HOT_WALLET_SECRET = "SDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.HOT_WALLET_PUBLIC_KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.WEBHOOK_SECRET = "test-webhook-secret";
process.env.S3_ENDPOINT = "http://localhost:9000";
process.env.S3_ACCESS_KEY_ID = "minioadmin";
process.env.S3_SECRET_ACCESS_KEY = "minioadmin";
process.env.S3_PUBLIC_URL = "http://localhost:9000/brandblitz-assets";
process.env.SESSION_INTEGRITY_KEY = "replace-with-at-least-32-random-chars";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { softDeleteUser, restoreUser, findUserById } from "./users";
import { softDeleteChallenge, restoreChallenge, getChallengeById } from "./challenges";
import { deleteBrand, getBrandById } from "./brands";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `soft_delete_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

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

describeIntegration("soft-delete pattern", () => {
  let query: typeof import("../index").query;
  let closeDb: typeof import("../index").closeDb;

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
        display_name TEXT NOT NULL,
        google_id TEXT UNIQUE,
        username TEXT UNIQUE,
        avatar_url TEXT,
        role TEXT NOT NULL DEFAULT 'player',
        phone_hash TEXT UNIQUE,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        phone_verified_at TIMESTAMPTZ,
        age_verified BOOLEAN NOT NULL DEFAULT FALSE,
        kyc_complete BOOLEAN NOT NULL DEFAULT FALSE,
        stellar_address TEXT,
        embedded_wallet_address TEXT,
        referral_code TEXT UNIQUE,
        league TEXT,
        total_score BIGINT NOT NULL DEFAULT 0,
        total_earned_usdc NUMERIC(20, 7) NOT NULL DEFAULT 0,
        challenges_played INTEGER NOT NULL DEFAULT 0,
        state_code TEXT,
        streak INTEGER NOT NULL DEFAULT 0,
        last_play_day DATE,
        streak_repairs_this_month INTEGER NOT NULL DEFAULT 0,
        streak_repair_available BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE brands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        logo_url TEXT,
        primary_color TEXT DEFAULT '#6366f1',
        secondary_color TEXT DEFAULT '#a5b4fc',
        tagline TEXT,
        brand_story TEXT,
        usp TEXT,
        product_image_keys TEXT[] NOT NULL DEFAULT '{}',
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      CREATE TABLE challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
        challenge_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending_deposit',
        pool_amount_stroops BIGINT NOT NULL DEFAULT 0,
        deposit_memo TEXT UNIQUE,
        deposit_tx_hash TEXT UNIQUE,
        max_players INTEGER,
        starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ends_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

  async function insertUser(email: string): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [email, email]
    );
    return result.rows[0].id;
  }

  async function insertBrand(ownerId: string, name: string): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO brands (owner_user_id, name) VALUES ($1, $2) RETURNING id`,
      [ownerId, name]
    );
    return result.rows[0].id;
  }

  async function insertChallenge(brandId: string, challengeId: string): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO challenges (brand_id, challenge_id) VALUES ($1, $2) RETURNING id`,
      [brandId, challengeId]
    );
    return result.rows[0].id;
  }

  it("users soft-delete and restore works", async () => {
    const userId = await insertUser("user@test.com");

    // Visible initially
    const user = await findUserById(userId);
    expect(user).not.toBeNull();

    // Soft delete
    await softDeleteUser(userId);

    // Invisible to normal query
    const userAfter = await findUserById(userId);
    expect(userAfter).toBeNull();

    // Visible with explicit SQL (simulating admin tool)
    const rawRes = await query("SELECT * FROM users WHERE id = $1 /* include_deleted */", [userId]);
    expect(rawRes.rows[0].deleted_at).not.toBeNull();

    // Restore
    await restoreUser(userId);

    // Visible again
    const userRestored = await findUserById(userId);
    expect(userRestored).not.toBeNull();
    expect(userRestored?.deleted_at).toBeNull();
  });

  it("brands soft-delete works (existing implementation)", async () => {
    const ownerId = await insertUser("brand-owner@test.com");
    const brandId = await insertBrand(ownerId, "Soft Brand");

    // Visible initially
    const brand = await getBrandById(brandId);
    expect(brand).not.toBeNull();

    // Soft delete
    await deleteBrand(brandId, ownerId);

    // Invisible to normal query
    const brandAfter = await getBrandById(brandId);
    expect(brandAfter).toBeNull();
  });

  it("challenges soft-delete and restore works", async () => {
    const ownerId = await insertUser("chal-owner@test.com");
    const brandId = await insertBrand(ownerId, "Chal Brand");
    const id = await insertChallenge(brandId, "CHAL-123");

    // Visible initially
    const challenge = await getChallengeById(id);
    expect(challenge).not.toBeNull();

    // Soft delete
    await softDeleteChallenge(id);

    // Invisible to normal query
    const chalAfter = await getChallengeById(id);
    expect(chalAfter).toBeNull();

    // Restore
    await restoreChallenge(id);

    // Visible again
    const chalRestored = await getChallengeById(id);
    expect(chalRestored).not.toBeNull();
  });
});
