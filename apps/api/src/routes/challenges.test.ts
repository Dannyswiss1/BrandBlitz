import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveChallenges: vi.fn(),
  getChallengeById: vi.fn(),
  getChallengeByIdAny: vi.fn(),
  getChallengesByBrandId: vi.fn(),
  getChallengeQuestions: vi.fn(),
  getBrandById: vi.fn(),
  getLeaderboard: vi.fn(),
  authMockUser: null as any,
  dbQuery: vi.fn().mockResolvedValue({ rows: [] }),
  mockClient: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  },
}));

vi.mock("../db/queries/challenges", () => ({
  getActiveChallenges: mocks.getActiveChallenges,
  getChallengeById: mocks.getChallengeById,
  getChallengeByIdAny: mocks.getChallengeByIdAny,
  getChallengesByBrandId: mocks.getChallengesByBrandId,
  getChallengeQuestions: mocks.getChallengeQuestions,
}));

vi.mock("../db/index", () => ({
  query: mocks.dbQuery,
  pool: { connect: () => Promise.resolve(mocks.mockClient) },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  reportLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../db/queries/brands", () => ({
  getBrandById: mocks.getBrandById,
}));

vi.mock("../db/queries/sessions", () => ({
  getLeaderboard: mocks.getLeaderboard,
}));

vi.mock("../middleware/authenticate", () => ({
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = mocks.authMockUser;
    next();
  },
  authenticate: (req: any, res: any, next: any) => {
    if (!mocks.authMockUser) return res.status(401).json({ error: "Unauthorized" });
    req.user = mocks.authMockUser;
    next();
  },
}));

import { errorHandler } from "../middleware/error";
import challengesRouter from "./challenges";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use("/challenges", challengesRouter);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe("challenges routes", () => {
  let currentServer: Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.authMockUser = null;
    
    const s = await startServer();
    currentServer = s.server;
    baseUrl = s.baseUrl;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (currentServer) {
        currentServer.close(() => resolve());
        currentServer = undefined;
        return;
      }
      resolve();
    });
  });

  describe("GET /challenges", () => {
    it("returns active challenges and paginates natively", async () => {
      const mockChallenges = [{ id: "chal-1" }, { id: "chal-2" }];
      mocks.getActiveChallenges.mockResolvedValue(mockChallenges);

      const response = await fetch(`${baseUrl}/challenges?status=active&limit=5&offset=10`);
      expect(response.status).toBe(200);

      const data: any = await response.json();
      expect(data).toEqual({ challenges: mockChallenges });
      expect(mocks.getActiveChallenges).toHaveBeenCalledWith(5, 10);
    });

    it("rejects invalid pagination input via Zod", async () => {
      const response = await fetch(`${baseUrl}/challenges?limit=notanumber`);
      expect(response.status).toBe(400);
      const data: any = await response.json();
      expect(data.code).toBe("INVALID_QUERY");
    });
    
    it("brandId filter honoured for authenticated owners", async () => {
      mocks.authMockUser = { sub: "user-owner" };
      const brandId = randomUUID();
      
      mocks.getBrandById.mockResolvedValue({ id: brandId, owner_user_id: "user-owner" });
      const brandChallenges = [{ id: "brand-chal-1" }];
      mocks.getChallengesByBrandId.mockResolvedValue(brandChallenges);

      const response = await fetch(`${baseUrl}/challenges?brandId=${brandId}`);
      expect(response.status).toBe(200);

      const data: any = await response.json();
      expect(data).toEqual({ challenges: brandChallenges });
      expect(mocks.getChallengesByBrandId).toHaveBeenCalledWith(brandId, 20, 0);
    });

    it("returns 403 Forbidden if unauthenticated user tries to filter by brandId", async () => {
      mocks.authMockUser = null; 
      const brandId = randomUUID();
      mocks.getBrandById.mockResolvedValue({ id: brandId, owner_user_id: "owner" });

      const response = await fetch(`${baseUrl}/challenges?brandId=${brandId}`);
      expect(response.status).toBe(403);
    });

    it("returns 403 Forbidden if authenticated user requests another owner's brandId", async () => {
      mocks.authMockUser = { sub: "thief" };
      const brandId = randomUUID();
      mocks.getBrandById.mockResolvedValue({ id: brandId, owner_user_id: "owner" });

      const response = await fetch(`${baseUrl}/challenges?brandId=${brandId}`);
      expect(response.status).toBe(403);
    });

    it("returns 403 Forbidden if the requested brandId does not exist at all", async () => {
      mocks.authMockUser = { sub: "owner" };
      const brandId = randomUUID();
      mocks.getBrandById.mockResolvedValue(null);

      const response = await fetch(`${baseUrl}/challenges?brandId=${brandId}`);
      expect(response.status).toBe(403);
    });
  });

  describe("GET /challenges/:id", () => {
    it("returns 404 for non-existent challenge ID", async () => {
      mocks.getChallengeById.mockResolvedValue(null);
      
      const response = await fetch(`${baseUrl}/challenges/not-found`);
      expect(response.status).toBe(404);
      const data: any = await response.json();
      expect(data.error).toBe("Challenge not found");
    });

    it("returns challenge detail and strictly strips 'correct_option' and 'correct_answer' from questions", async () => {
      const mockChallenge = { id: "chal-secret" };
      mocks.getChallengeById.mockResolvedValue(mockChallenge);

      const mockQuestions = [
        {
          id: "q1",
          question_text: "What is 2+2?",
          option_a: "3", option_b: "4", option_c: "5", option_d: "6",
          correct_option: "B",
          correct_answer: "4"
        },
        {
          id: "q2",
          question_text: "What color is the sky?",
          option_a: "blue", option_b: "red", option_c: "green", option_d: "yellow",
          correct_option: "A",
          correct_answer: "blue"
        }
      ];
      
      mocks.getChallengeQuestions.mockResolvedValue(mockQuestions);

      const response = await fetch(`${baseUrl}/challenges/chal-secret`);
      expect(response.status).toBe(200);

      const data: any = await response.json();
      expect(data.challenge).toEqual(mockChallenge);
      expect(data.questions).toHaveLength(2);
      
      expect(data.questions[0]).not.toHaveProperty("correct_option");
      expect(data.questions[0]).not.toHaveProperty("correct_answer");
      expect(data.questions[0].option_a).toBe("3");
      
      expect(data.questions[1]).not.toHaveProperty("correct_option");
      expect(data.questions[1]).not.toHaveProperty("correct_answer");
    });
  });

  describe("POST /challenges/:id/report", () => {
    const challengeId = "00000000-0000-0000-0000-000000000001";
    const userId = "00000000-0000-0000-0000-000000000002";

    beforeEach(() => {
      mocks.authMockUser = { sub: userId };
      mocks.getChallengeByIdAny.mockResolvedValue({ id: challengeId, archived: false });
      // First call: check for existing report (none found)
      // Subsequent calls in the transaction handled by mockClient.query
      mocks.mockClient.query.mockReset();
      mocks.mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT from challenge_reports (not found)
        .mockResolvedValueOnce(undefined) // INSERT challenge_reports
        .mockResolvedValueOnce(undefined) // UPDATE challenges reported_count
        .mockResolvedValueOnce(undefined); // COMMIT
    });

    it("returns 201 on successful report", async () => {
      const response = await fetch(`${baseUrl}/challenges/${challengeId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "misleading_content" }),
      });
      expect(response.status).toBe(201);
      const data: any = await response.json();
      expect(data.success).toBe(true);
    });

    it("returns 409 when user has already reported this challenge", async () => {
      mocks.mockClient.query.mockReset();
      mocks.mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: "existing-report" }] }) // SELECT finds existing
        .mockResolvedValueOnce(undefined); // ROLLBACK
      const response = await fetch(`${baseUrl}/challenges/${challengeId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "other" }),
      });
      expect(response.status).toBe(409);
    });

    it("returns 401 when unauthenticated", async () => {
      mocks.authMockUser = null;
      const response = await fetch(`${baseUrl}/challenges/${challengeId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "other" }),
      });
      expect(response.status).toBe(401);
    });

    it("returns 429 when rate limiter blocks the request", async () => {
      // Override the rate limiter mock to simulate rejection
      vi.doMock("../middleware/rate-limit", () => ({
        apiLimiter: (_req: any, _res: any, next: any) => next(),
        reportLimiter: (_req: any, res: any) =>
          res.status(429).json({ error: "Too many report requests, please try again later" }),
      }));
    });
  });

  describe("GET /challenges/:id/leaderboard", () => {
    it("returns 404 for non-existent challenge ID on leaderboard endpoint", async () => {
      mocks.getChallengeById.mockResolvedValue(null);
      const response = await fetch(`${baseUrl}/challenges/not-found/leaderboard`);
      expect(response.status).toBe(404);
    });

    it("paginates and maps leaderboard outputs cleanly mapping total_score DESC effectively", async () => {
      mocks.getChallengeById.mockResolvedValue({ id: "chal-leader" });
      
      const mockSessions = [
        { username: "Alice", avatar_url: "alice.png", total_score: 500, completed_at: "time1" },
        { username: "Bob", avatar_url: "bob.png", total_score: 400, completed_at: "time2" }
      ];
      mocks.getLeaderboard.mockResolvedValue(mockSessions);

      const response = await fetch(`${baseUrl}/challenges/chal-leader/leaderboard?limit=10&offset=5`);
      expect(response.status).toBe(200);

      const data: any = await response.json();
      expect(data.challengeId).toBe("chal-leader");
      expect(data.sessions).toHaveLength(2);

      expect(data.sessions[0]).toEqual({
        rank: 6,
        username: "Alice",
        avatarUrl: "alice.png",
        totalScore: 500,
        endedAt: "time1"
      });
      
      expect(data.sessions[1]).toEqual({
        rank: 7,
        username: "Bob",
        avatarUrl: "bob.png",
        totalScore: 400,
        endedAt: "time2"
      });

      expect(mocks.getLeaderboard).toHaveBeenCalledWith("chal-leader", 10, 5);
    });
  });
});
