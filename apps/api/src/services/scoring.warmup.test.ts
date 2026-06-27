import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  redisGet: vi.fn(),
}));

vi.mock("../db", () => ({
  pool: { connect: mocks.connect },
}));

vi.mock("../lib/config", () => ({
  config: { WARMUP_COMPLETE_LOCK_TIMEOUT_MS: 25 },
}));

vi.mock("../lib/redis", () => ({
  redis: { get: mocks.redisGet },
}));

import { completeWarmupWithLock } from "./scoring";

describe("completeWarmupWithLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue("0");
  });

  it("serializes concurrent completions and rejects the request that acquires the lock second", async () => {
    let warmupCompletedAt: string | null = null;
    let releaseFirstTransaction!: () => void;
    const firstTransactionFinished = new Promise<void>((resolve) => {
      releaseFirstTransaction = resolve;
    });
    const statements: string[] = [];
    let connectionNumber = 0;

    mocks.connect.mockImplementation(async () => {
      const connection = connectionNumber++;
      return {
        query: vi.fn(async (sql: string) => {
          statements.push(sql.replace(/\s+/g, " ").trim());

          if (sql.includes("FROM game_sessions") && sql.includes("FOR UPDATE")) {
            if (connection === 1) await firstTransactionFinished;
            return {
              rows: [{
                id: "session-1",
                user_id: "user-1",
                challenge_id: "challenge-1",
                warmup_completed_at: warmupCompletedAt,
              }],
            };
          }

          if (sql.includes("UPDATE game_sessions")) {
            warmupCompletedAt = "2026-06-23T20:00:00.000Z";
            return {
              rows: [{
                id: "session-1",
                user_id: "user-1",
                challenge_id: "challenge-1",
                warmup_completed_at: warmupCompletedAt,
              }],
            };
          }

          if (sql === "COMMIT" && connection === 0) releaseFirstTransaction();
          return { rows: [] };
        }),
        release: vi.fn(),
      };
    });

    const results = await Promise.allSettled([
      completeWarmupWithLock({ userId: "user-1", challengeId: "challenge-1" }),
      completeWarmupWithLock({ userId: "user-1", challengeId: "challenge-1" }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: { statusCode: 409, code: "WARMUP_ALREADY_COMPLETED" },
    });
    expect(statements.filter((sql) => sql.includes("FOR UPDATE"))).toHaveLength(2);
    expect(statements.filter((sql) => sql.startsWith("UPDATE game_sessions"))).toHaveLength(1);
    expect(statements.some((sql) => sql.includes("session_round_scores"))).toBe(false);
  });

  it("rolls back and returns a conflict when the row lock times out", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FOR UPDATE")) {
        throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      }
      return { rows: [] };
    });
    const release = vi.fn();
    mocks.connect.mockResolvedValue({ query, release });

    await expect(
      completeWarmupWithLock({ userId: "user-1", challengeId: "challenge-1" })
    ).rejects.toMatchObject({ statusCode: 409, code: "WARMUP_LOCK_TIMEOUT" });

    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
