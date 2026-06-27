import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import sessionsRouter from "./sessions";
import { errorHandler } from "../middleware/error";

const testState = vi.hoisted(() => ({
  revokedTokens: new Set<string>(),
}));

// Mock dependencies
vi.mock("../db/queries/challenges");
vi.mock("../db/queries/sessions");
vi.mock("../services/scoring");
vi.mock("../lib/redis", () => ({
  redis: {
    set: vi.fn((key: string) => {
      if (key.startsWith("auth:revoked:")) {
        testState.revokedTokens.add(key);
      }
      return Promise.resolve("OK");
    }),
    get: vi.fn(),
    del: vi.fn(),
  },
}));
vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (token && testState.revokedTokens.has(`auth:revoked:${token}`)) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    req.user = { sub: "user123", email: "test@example.com", iat: 1, exp: 9999999999 };
    next();
  },
  tokenRevocationKey: (token: string) => `auth:revoked:${token}`,
  tokenTtlSeconds: () => 600,
}));
vi.mock("../middleware/anti-cheat", () => ({
  enforceOneSessionPerChallenge: (req: any, res: any, next: any) => {
    // Attach a mock session so the handler can use it
    req.session = { id: "s1", user_id: "user123" };
    next();
  },
  validateReactionTime: (req: any, res: any, next: any) => next(),
  validateDeviceFingerprint: (req: any, res: any, next: any) => next(),
  requireSessionStartAllowed: (req: any, res: any, next: any) => next(),
  assertValidTotalScore: vi.fn(),
}));
vi.mock("../middleware/require-active-user", () => ({
  requireActiveUser: (req: any, res: any, next: any) => next(),
}));
vi.mock("../middleware/rate-limit", () => ({
  challengeStartLimiter: (req: any, res: any, next: any) => next(),
}));
vi.mock("../lib/integrity", () => ({
  computeSessionHmac: vi.fn().mockReturnValue("test-hmac"),
}));
vi.mock("@brandblitz/stellar", () => ({
  WARMUP_MIN_SECONDS: 20,
}));
vi.mock("../services/streaks", () => ({
  updateStreak: vi.fn(),
}));
vi.mock("../services/badges", () => ({
  checkAndAwardSessionBadges: vi.fn(),
}));

import * as challengeQueries from "../db/queries/challenges";
import * as sessionQueries from "../db/queries/sessions";
import { redis } from "../lib/redis";
import * as scoringService from "../services/scoring";
import { updateStreak } from "../services/streaks";

const app = express();
app.use(express.json());
app.use("/sessions", sessionsRouter);
app.use(errorHandler);

describe("Sessions API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testState.revokedTokens.clear();
  });

  describe("GET /sessions/:challengeId", () => {
    it("returns in-progress recovery details with last answered round", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        status: "active",
        challenge_started_at: new Date(Date.now() - 5000).toISOString(),
        completed_at: null,
        round_1_answer: "A",
        round_1_score: 100,
        round_2_answer: null,
        round_2_score: 0,
        round_3_answer: null,
        round_3_score: 0,
        total_score: 100,
      });

      const res = await request(app).get("/sessions/c1");

      expect(res.status).toBe(200);
      expect(res.body.session).toEqual(expect.objectContaining({
        id: "s1",
        status: "in_progress",
        last_answered_round: 1,
        current_round: 2,
        total_score: 100,
        round_scores: [100, 0, 0],
      }));
      expect(res.body.session.remaining_time_ms).toBeGreaterThan(0);
    });

    it("maps abandoned sessions to expired recovery status", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        status: "abandoned",
        challenge_started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: null,
        round_1_answer: "A",
        round_1_score: 100,
        round_2_answer: null,
        round_2_score: 0,
        round_3_answer: null,
        round_3_score: 0,
        total_score: 100,
      });

      const res = await request(app).get("/sessions/c1");

      expect(res.status).toBe(200);
      expect(res.body.session.status).toBe("expired");
      expect(res.body.session.remaining_time_ms).toBe(0);
    });
  });

  describe("DELETE /sessions/:challengeId", () => {
    it("forfeits an open session", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.deleteOpenSession as any).mockResolvedValue(true);

      const res = await request(app).delete("/sessions/c1");

      expect(res.status).toBe(204);
      expect(sessionQueries.deleteOpenSession).toHaveBeenCalledWith("user123", "c1");
    });

    it("returns 404 when there is no open session to forfeit", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.deleteOpenSession as any).mockResolvedValue(false);

      const res = await request(app).delete("/sessions/c1");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /sessions/:challengeId/warmup-start", () => {
    it("should start warmup happy path", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1", status: "active" });
      (sessionQueries.createSession as any).mockResolvedValue({ id: "s1" });

      const res = await request(app).post("/sessions/c1/warmup-start").send({ isPractice: false });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("sessionId", "s1");
      expect(redis.set).toHaveBeenCalled();
    });

    it("should 404 if challenge not available", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue(null);

      const res = await request(app).post("/sessions/c1/warmup-start");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /sessions/:challengeId/warmup-complete", () => {
    it("should complete warmup happy path", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });
      (scoringService.completeWarmupWithLock as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
      });

      const res = await request(app).post("/sessions/c1/warmup-complete");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("challengeToken");
      expect(scoringService.completeWarmupWithLock).toHaveBeenCalledWith({
        userId: "user123",
        challengeId: "c1",
      });
    });

    it("should 400 if warmup too fast", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });
      const error = new Error("Warm-up minimum not yet elapsed") as any;
      error.statusCode = 400;
      error.code = "WARMUP_TOO_FAST";
      (scoringService.completeWarmupWithLock as any).mockRejectedValue(error);

      const res = await request(app).post("/sessions/c1/warmup-complete");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("WARMUP_TOO_FAST");
    });

    it("allows only one concurrent warmup completion", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });
      const conflict = new Error("Warm-up already completed") as any;
      conflict.statusCode = 409;
      conflict.code = "WARMUP_ALREADY_COMPLETED";
      (scoringService.completeWarmupWithLock as any)
        .mockResolvedValueOnce({ id: "s1", user_id: "user123" })
        .mockRejectedValueOnce(conflict);

      const [first, second] = await Promise.all([
        request(app).post("/sessions/c1/warmup-complete"),
        request(app).post("/sessions/c1/warmup-complete"),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);
      expect(scoringService.completeWarmupWithLock).toHaveBeenCalledTimes(2);
    });
  });

  describe("POST /sessions/:challengeId/start", () => {
    it("should start challenge happy path", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue("s1");
      (sessionQueries.getSession as any).mockResolvedValue({ id: "s1", user_id: "user123" });

      const res = await request(app)
        .post("/sessions/c1/start")
        .set("Authorization", "Bearer active-jwt")
        .send({ challengeToken: "valid-token" });

      expect(res.status).toBe(200);
      expect(sessionQueries.markChallengeStarted).toHaveBeenCalledWith("s1");
      expect(redis.set).toHaveBeenCalledWith("session-token:s1", "active-jwt", "EX", 600);
    });

    it("should 401 if invalid token", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (redis.get as any).mockResolvedValue(null);

      const res = await request(app)
        .post("/sessions/c1/start")
        .send({ challengeToken: "invalid-token" });

      expect(res.status).toBe(401);
    });
  });

  describe("POST /sessions/:challengeId/answer/:round", () => {
    it("should record answer happy path", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 1, correct_option: "A" },
      ]);
      (scoringService.calculateRoundScore as any).mockReturnValue(100);
      (scoringService.validateAnswer as any).mockReturnValue(true);

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(100);
      expect(sessionQueries.recordRoundScore).toHaveBeenCalledWith("s1", 1, 100, "A", 500);
    });

    it("should accept timeout answer and score 0", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 1, correct_option: "A" },
      ]);
      (scoringService.calculateRoundScore as any).mockReturnValue(0);
      (scoringService.validateAnswer as any).mockReturnValue(false);

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: null, reactionTimeMs: 15000 });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(0);
      expect(sessionQueries.recordRoundScore).toHaveBeenCalledWith("s1", 1, 0, null, 15000);
      expect(scoringService.calculateRoundScore).toHaveBeenCalledWith({
        selectedOption: null,
        correctOption: "A",
        reactionTimeMs: 15000,
      });
    });

    it("should finalize session on round 3 and store HMAC", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 3, correct_option: "B" },
      ]);
      (sessionQueries.finishSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        total_score: 300,
        completed_at: new Date().toISOString(),
      });

      const res = await request(app)
        .post("/sessions/c1/answer/3")
        .set("Authorization", "Bearer completed-jwt")
        .send({ selectedOption: "B", reactionTimeMs: 400 });

      expect(res.status).toBe(200);
      expect(sessionQueries.finishSession).toHaveBeenCalledWith("s1");
      expect(redis.del).toHaveBeenCalledWith("session-token:s1");
      expect(redis.del).toHaveBeenCalledWith("session:start:s1");
      expect(redis.set).toHaveBeenCalledWith(
        "auth:revoked:completed-jwt",
        "1",
        "EX",
        600
      );
    });

    it("rejects a replayed answer request after completion revokes the token", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 3, correct_option: "B" },
      ]);

      const first = await request(app)
        .post("/sessions/c1/answer/3")
        .set("Authorization", "Bearer replay-jwt")
        .send({ selectedOption: "B", reactionTimeMs: 400 });

      expect(first.status).toBe(200);

      const replay = await request(app)
        .post("/sessions/c1/answer/3")
        .set("Authorization", "Bearer replay-jwt")
        .send({ selectedOption: "B", reactionTimeMs: 400 });

      expect(replay.status).toBe(401);
      expect(sessionQueries.storeSessionHmac).toHaveBeenCalledWith("s1", "test-hmac");
      expect(updateStreak).toHaveBeenCalledWith("user123");
    });

    it("should 409 if session already completed on round 1", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
        completed_at: new Date(),
      });

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(409);
    });

    it("should return 200 with cached result on idempotent round-3 replay", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
        completed_at: new Date(),
        round_3_answer: "A",
        round_3_score: 100,
        total_score: 300,
        rank: 2,
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 3, correct_option: "A" },
      ]);
      (scoringService.validateAnswer as any).mockReturnValue(true);

      const res = await request(app)
        .post("/sessions/c1/answer/3")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(200);
      expect(res.body.score).toBe(100);
      expect(res.body.total_score).toBe(300);
      expect(res.body.rank).toBe(2);
      expect(sessionQueries.recordRoundScore).not.toHaveBeenCalled();
      expect(sessionQueries.finishSession).not.toHaveBeenCalled();
    });

    it("should return 409 CONFLICT_REPLAY when round-3 replay has a different answer", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
        completed_at: new Date(),
        round_3_answer: "A",
        round_3_score: 100,
        total_score: 300,
      });
      (challengeQueries.getChallengeQuestions as any).mockResolvedValue([
        { round: 3, correct_option: "A" },
      ]);

      const res = await request(app)
        .post("/sessions/c1/answer/3")
        .send({ selectedOption: "B", reactionTimeMs: 500 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CONFLICT_REPLAY");
    });

    it("should 403 if session is flagged", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
        is_flagged: true,
      });

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(403);
    });

    it("should 400 for double answer", async () => {
      (challengeQueries.getChallengeById as any).mockResolvedValue({ id: "c1" });
      (sessionQueries.getSession as any).mockResolvedValue({
        id: "s1",
        user_id: "user123",
        challenge_started_at: new Date(),
        scores: [{ round: 1, score: 100 }],
      });

      const res = await request(app)
        .post("/sessions/c1/answer/1")
        .send({ selectedOption: "A", reactionTimeMs: 500 });

      expect(res.status).toBe(400);
    });

    it("should 400 for invalid round", async () => {
      const res = await request(app)
        .post("/sessions/c1/answer/4")
        .send({ selectedOption: "A", reactionTimeMs: 500 });
      expect(res.status).toBe(400);
    });
  });
});
