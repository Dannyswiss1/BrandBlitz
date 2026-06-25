import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import leaderboardRouter from "./leaderboard";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getActiveChallenges: vi.fn(),
  getTopSessionsPerChallenge: vi.fn(),
  getGlobalLeaderboardFromView: vi.fn(),
  getLeaderboard: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
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
  getGlobalLeaderboardFromView: (...args: unknown[]) => {
    mocks.dbQueryCount.value++;
    return mocks.getGlobalLeaderboardFromView(...args);
  },
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
    set: mocks.redisSet,
    del: mocks.redisDel,
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

// Shape returned by getGlobalLeaderboardFromView (pre-computed rank from the MV)
const VIEW_ROWS = [
  {
    challenge_id: "challenge-aaa", rank: 1,
    user_id: "u1", username: "alice", display_name: "Alice", league: null,
    avatar_url: null, total_score: 300, total_earned_usdc: "0.0000000",
  },
  {
    challenge_id: "challenge-aaa", rank: 2,
    user_id: "u2", username: "bob", display_name: "Bob", league: null,
    avatar_url: null, total_score: 200, total_earned_usdc: "0.0000000",
  },
  {
    challenge_id: "challenge-bbb", rank: 1,
    user_id: "u3", username: "carol", display_name: "Carol", league: "gold" as const,
    avatar_url: "https://cdn.example.com/carol.png", total_score: 400, total_earned_usdc: "1.0000000",
  },

];

// Legacy shape still used by the SSE stream route
const TOP_SESSIONS = [
  {
    id: "s1", user_id: "u1", challenge_id: "challenge-aaa",
    username: "alice", display_name: "Alice", league: null,
    avatar_url: null, total_score: 300, completed_at: "2026-01-01T01:00:00Z",
    total_earned_usdc: "0.0000000",
  },
  {
    id: "s2", user_id: "u2", challenge_id: "challenge-aaa",
    username: "bob", display_name: "Bob", league: null,
    avatar_url: null, total_score: 200, completed_at: "2026-01-01T02:00:00Z",
    total_earned_usdc: "0.0000000",
  },
  {
    id: "s3", user_id: "u3", challenge_id: "challenge-bbb",
    username: "carol", display_name: "Carol", league: "gold" as const,
    avatar_url: "https://cdn.example.com/carol.png", total_score: 400, completed_at: "2026-01-01T03:00:00Z",
    total_earned_usdc: "1.0000000",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /leaderboard/global", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbQueryCount.value = 0;
    mocks.redisGet.mockResolvedValue(null);
    mocks.redisSet.mockResolvedValue("OK");
    mocks.redisDel.mockResolvedValue(1);
    mocks.getActiveChallenges.mockResolvedValue(CHALLENGES);
    mocks.getGlobalLeaderboardFromView.mockResolvedValue(VIEW_ROWS);
  });

  it("returns 200 with a leaderboard array", async () => {
    const res = await request(createApp()).get("/leaderboard/global");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.leaderboard)).toBe(true);
  });

  it("cache fallback path reads from the materialised view, not the raw tables", async () => {
    await request(createApp()).get("/leaderboard/global");
    // One DB call: getGlobalLeaderboardFromView; raw aggregate scan is NOT used
    expect(mocks.dbQueryCount.value).toBe(1);
    expect(mocks.getLeaderboard).not.toHaveBeenCalled();
    expect(mocks.getTopSessionsPerChallenge).not.toHaveBeenCalled();
  });

  it("calls getGlobalLeaderboardFromView with all challenge IDs", async () => {
    await request(createApp()).get("/leaderboard/global");
    expect(mocks.getGlobalLeaderboardFromView).toHaveBeenCalledWith(
      ["challenge-aaa", "challenge-bbb"],
      10
    );
  });

  it("view rows returns pre-computed per-challenge rank", async () => {
    const res = await request(createApp()).get("/leaderboard/global");
    const lb = res.body.leaderboard as Array<{ challengeId: string; rank: number }>;

    const aaa = lb.filter((e) => e.challengeId === "challenge-aaa");
    const bbb = lb.filter((e) => e.challengeId === "challenge-bbb");

    expect(aaa.map((e) => e.rank)).toEqual([1, 2]);
    expect(bbb.map((e) => e.rank)).toEqual([1]);
  });

  it("orders sessions by ascending rank within each challenge", async () => {
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
      expect.stringMatching(/^leaderboard:global:/),
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
    mocks.getGlobalLeaderboardFromView.mockResolvedValue([]);

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
