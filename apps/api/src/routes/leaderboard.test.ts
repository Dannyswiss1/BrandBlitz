import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import leaderboardRouter from "./leaderboard";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getActiveChallenges: vi.fn(),
  getTopSessionsPerChallenge: vi.fn(),
  getLeaderboard: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  dbQueryCount: { value: 0 },
}));

vi.mock("../db/queries/challenges", () => ({
  getActiveChallenges: mocks.getActiveChallenges,
}));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: (...args: unknown[]) => {
    mocks.dbQueryCount.value++;
    return mocks.getLeaderboard(...args);
  },
  getTopSessionsPerChallenge: (...args: unknown[]) => {
    mocks.dbQueryCount.value++;
    return mocks.getTopSessionsPerChallenge(...args);
  },
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/leaderboard", leaderboardRouter);
  return app;
}

const CHALLENGES = [{ id: "challenge-aaa" }, { id: "challenge-bbb" }];

const TOP_SESSIONS = [
  {
    id: "s1", user_id: "u1", challenge_id: "challenge-aaa",
    username: "alice", avatar_url: null, total_score: 300, completed_at: "2026-01-01T01:00:00Z",
  },
  {
    id: "s2", user_id: "u2", challenge_id: "challenge-aaa",
    username: "bob", avatar_url: null, total_score: 200, completed_at: "2026-01-01T02:00:00Z",
  },
  {
    id: "s3", user_id: "u3", challenge_id: "challenge-bbb",
    username: "carol", avatar_url: "https://cdn.example.com/carol.png", total_score: 400, completed_at: "2026-01-01T03:00:00Z",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /leaderboard/global", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQueryCount.value = 0;
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.getActiveChallenges.mockResolvedValue(CHALLENGES);
    mocks.getTopSessionsPerChallenge.mockResolvedValue(TOP_SESSIONS);
  });

  it("returns 200 with a leaderboard array", async () => {
    const res = await request(createApp()).get("/leaderboard/global");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });

  it("issues exactly one DB query — not N+1", async () => {
    await request(createApp()).get("/leaderboard/global");
    expect(mocks.dbQueryCount.value).toBe(1);
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
  });

  it("calls getTopSessionsPerChallenge with all challenge IDs", async () => {
    await request(createApp()).get("/leaderboard/global");
    expect(mocks.getTopSessionsPerChallenge).toHaveBeenCalledWith(
      ["challenge-aaa", "challenge-bbb"],
      10
    );
  });

  it("assigns sequential rank per challenge, restarting at 1 for each", async () => {
    const res = await request(createApp()).get("/leaderboard/global");
    const lb = res.body.leaderboard as Array<{ challengeId: string; rank: number }>;

    const aaa = lb.filter((e) => e.challengeId === "challenge-aaa");
    const bbb = lb.filter((e) => e.challengeId === "challenge-bbb");

    expect(aaa.map((e) => e.rank)).toEqual([1, 2]);
    expect(bbb.map((e) => e.rank)).toEqual([1]);
  });

  it("orders sessions by descending score within each challenge", async () => {
    const res = await request(createApp()).get("/leaderboard/global");
    const aaaScores = (res.body.leaderboard as Array<{ challengeId: string; totalScore: number }>)
      .filter((e) => e.challengeId === "challenge-aaa")
      .map((e) => e.totalScore);
    expect(aaaScores).toEqual([300, 200]);
  });

  it("includes cachedAt ISO timestamp in the response", async () => {
    const res = await request(createApp()).get("/leaderboard/global");
    expect(typeof res.body.cachedAt).toBe("string");
    expect(Number.isNaN(Date.parse(res.body.cachedAt))).toBe(false);
  });

  it("writes the result to Redis with a 300 s TTL", async () => {
    await request(createApp()).get("/leaderboard/global");
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "leaderboard:global",
      expect.any(String),
      "EX",
      300
    );
  });

  it("returns the cached payload without hitting the DB on a cache hit", async () => {
    const cachedPayload = {
      leaderboard: [{ rank: 1, challengeId: "challenge-aaa", username: "cached", avatarUrl: null, totalScore: 999 }],
      cachedAt: "2026-01-01T00:00:00.000Z",
    };
    mocks.redisGet.mockResolvedValue(JSON.stringify(cachedPayload));

    const res = await request(createApp()).get("/leaderboard/global");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedPayload);
    expect(mocks.dbQueryCount.value).toBe(0);
  });

  it("handles an empty active-challenges list gracefully", async () => {
    mocks.getActiveChallenges.mockResolvedValue([]);
    mocks.getTopSessionsPerChallenge.mockResolvedValue([]);

    const res = await request(createApp()).get("/leaderboard/global");

    expect(res.status).toBe(200);
    expect(res.body.leaderboard).toEqual([]);
  });
});

describe("GET /leaderboard/:challengeId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQueryCount.value = 0;
    mocks.getLeaderboard.mockResolvedValue([
      { id: "s1", user_id: "u1", challenge_id: "c1", username: "alice", avatar_url: null, total_score: 500 },
      { id: "s2", user_id: "u2", challenge_id: "c1", username: "bob",   avatar_url: null, total_score: 400 },
    ]);
  });

  it("returns sessions with rank starting at offset+1", async () => {
    const res = await request(createApp())
      .get("/leaderboard/c1")
      .query({ offset: 5 });

    expect(res.status).toBe(200);
    expect(res.body.sessions[0].rank).toBe(6);
    expect(res.body.sessions[1].rank).toBe(7);
  });

  it("passes limit and offset to getLeaderboard", async () => {
    await request(createApp())
      .get("/leaderboard/c1")
      .query({ limit: 5, offset: 10 });

    expect(mocks.getLeaderboard).toHaveBeenCalledWith("c1", 5, 10);
  });

  it("issues exactly one leaderboard query regardless of participant count", async () => {
    mocks.getLeaderboard.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) => ({
        id: `s${index}`,
        user_id: `u${index}`,
        challenge_id: "c1",
        username: `user${index}`,
        avatar_url: null,
        total_score: 500 - index,
      }))
    );

    const res = await request(createApp()).get("/leaderboard/c1");

    expect(res.status).toBe(200);
    expect(mocks.dbQueryCount.value).toBe(1);
  });
});
