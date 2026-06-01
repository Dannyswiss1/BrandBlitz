import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalDatabaseUrl = process.env.DATABASE_URL;
const schemaName = `users_muxed_id_test_${Date.now()}_${randomUUID().replace(/-/g, "")}`;

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

describeIntegration("users muxed_id partial unique index", () => {
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
        muxed_id BIGINT
      )
    `);

    await query(`
      CREATE UNIQUE INDEX users_muxed_id_unique
      ON users (muxed_id)
      WHERE muxed_id IS NOT NULL
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

  it("allows many NULL muxed IDs but rejects duplicate non-NULL muxed IDs", async () => {
    await query(
      `INSERT INTO users (email, display_name, muxed_id)
       VALUES ($1, $2, NULL), ($3, $4, NULL)`,
      [
        `null-1-${randomUUID()}@example.test`,
        "Null One",
        `null-2-${randomUUID()}@example.test`,
        "Null Two",
      ]
    );

    await query(
      `INSERT INTO users (email, display_name, muxed_id)
       VALUES ($1, $2, $3)`,
      [`muxed-1-${randomUUID()}@example.test`, "Muxed One", 12345]
    );

    await expect(
      query(
        `INSERT INTO users (email, display_name, muxed_id)
         VALUES ($1, $2, $3)`,
        [`muxed-2-${randomUUID()}@example.test`, "Muxed Two", 12345]
      )
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("uses the partial unique index for muxed ID lookups", async () => {
    await query("SET enable_seqscan = off");

    try {
      const plan = await query<{ "QUERY PLAN": string }>(
        "EXPLAIN SELECT id FROM users WHERE muxed_id = $1 /* include_deleted */",
        [12345]
      );

      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain(
        "users_muxed_id_unique"
      );
    } finally {
      await query("RESET enable_seqscan");
    }
  });
});
