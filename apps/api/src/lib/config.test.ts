/**
 * config.test.ts — Unit tests for the Zod-validated config module.
 *
 * Uses a separate .env.test file (loaded via vitest env) so the real
 * process.env is never polluted between test runs.
 *
 * Closes #96
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { ZodError } from "zod";
import { configSchema } from "./config-schema";

// ── Minimal valid env fixture ─────────────────────────────────────────────────

const VALID_ENV: Record<string, string> = {
  PORT: "3001",
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_SECRET: "a-very-long-jwt-secret-that-is-at-least-32-chars",
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  WEB_URL: "http://localhost:3000",
  ALLOWED_ORIGINS: "http://localhost:3000",
  STELLAR_NETWORK: "testnet",
  HOT_WALLET_SECRET: "SBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  HOT_WALLET_PUBLIC_KEY: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  WEBHOOK_SECRET: "webhook-secret-value",
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  S3_PUBLIC_URL: "http://localhost:9000/bucket",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("configSchema — valid env", () => {
  it("parses a complete valid env without throwing", () => {
    const result = configSchema.safeParse(VALID_ENV);
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional numeric fields", () => {
    const result = configSchema.safeParse(VALID_ENV);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(3001);
    expect(result.data.DB_POOL_MAX).toBe(10);
    expect(result.data.PAYOUT_WORKER_CONCURRENCY).toBe(2);
    expect(result.data.GOOGLE_OAUTH_PKCE_TTL_SECONDS).toBe(300);
    expect(result.data.REFERRER_POLICY).toBe("strict-origin-when-cross-origin");
  });

  it("coerces PORT from string to number", () => {
    const result = configSchema.safeParse({ ...VALID_ENV, PORT: "4000" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(4000);
  });

  it("accepts testnet and public for STELLAR_NETWORK", () => {
    for (const network of ["testnet", "public"] as const) {
      const result = configSchema.safeParse({ ...VALID_ENV, STELLAR_NETWORK: network });
      expect(result.success).toBe(true);
    }
  });

  it("defaults E2E_MOCK_GOOGLE_OAUTH to 'false'", () => {
    const result = configSchema.safeParse(VALID_ENV);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.E2E_MOCK_GOOGLE_OAUTH).toBe("false");
  });
});

describe("configSchema — missing required vars", () => {
  it("throws ZodError when DATABASE_URL is absent", () => {
    const { DATABASE_URL: _omit, ...env } = VALID_ENV;
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("DATABASE_URL");
  });

  it("throws ZodError when JWT_SECRET is too short", () => {
    const result = configSchema.safeParse({ ...VALID_ENV, JWT_SECRET: "short" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("JWT_SECRET");
  });

  it("throws ZodError when multiple required vars are missing", () => {
    const { DATABASE_URL: _db, REDIS_URL: _redis, JWT_SECRET: _jwt, ...env } = VALID_ENV;
    const result = configSchema.safeParse(env);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("DATABASE_URL");
    expect(paths).toContain("REDIS_URL");
    expect(paths).toContain("JWT_SECRET");
  });

  it("rejects an invalid NODE_ENV value", () => {
    const result = configSchema.safeParse({ ...VALID_ENV, NODE_ENV: "staging" });
    expect(result.success).toBe(false);
  });
});

describe("loadConfig — process.exit on invalid env", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("calls process.exit(1) when a required var is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    // Provide an env missing DATABASE_URL
    const { DATABASE_URL: _omit, ...partialEnv } = VALID_ENV;
    vi.stubEnv("DATABASE_URL", "");
    for (const [k, v] of Object.entries(partialEnv)) {
      vi.stubEnv(k, v);
    }

    // Re-import the module so loadConfig() runs with the stubbed env
    await expect(import("./config?bust=" + Date.now())).rejects.toThrow(
      "process.exit called"
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
