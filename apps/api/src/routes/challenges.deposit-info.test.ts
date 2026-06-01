import { describe, it, expect, beforeEach, vi } from "vitest";
import { Router } from "express";
import request from "supertest";
import express from "express";
import { z } from "zod";

// Mock dependencies
const mockGetChallengeByIdAny = vi.fn();
const mockGetBrandById = vi.fn();

vi.mock("../db/queries/challenges", () => ({
  getChallengeByIdAny: mockGetChallengeByIdAny,
  getActiveChallenges: vi.fn(),
  getChallengesByBrandId: vi.fn(),
  getChallengeQuestions: vi.fn(),
}));

vi.mock("../db/queries/brands", () => ({
  getBrandById: mockGetBrandById,
}));

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, res: any, next: any) => {
    req.user = { sub: "user-123" };
    next();
  },
  optionalAuth: (req: any, res: any, next: any) => next(),
}));

vi.mock("../middleware/error", () => ({
  createError: (msg: string, code: number) => {
    const err = new Error(msg);
    (err as any).statusCode = code;
    return err;
  },
}));

vi.mock("../lib/cache", () => ({
  cached: vi.fn((key, ttl, fn) => fn()),
}));

vi.mock("../lib/config", () => ({
  config: {
    HOT_WALLET_PUBLIC_KEY: "GHOTWALLETADDRESS",
  },
}));

describe("GET /challenges/:id/deposit-info", () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    // Import and use the router
    const challengesRouter = (await import("./challenges")).default;
    app.use("/challenges", challengesRouter);

    // Error handler
    app.use((err: any, req: any, res: any, next: any) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    });
  });

  it("should return 404 if challenge not found", async () => {
    mockGetChallengeByIdAny.mockResolvedValue(null);

    const res = await request(app).get("/challenges/unknown-id/deposit-info");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Challenge not found");
  });

  it("should return 403 if requester is not the brand owner", async () => {
    mockGetChallengeByIdAny.mockResolvedValue({
      id: "challenge-123",
      brand_id: "brand-123",
      status: "pending_deposit",
      pool_amount_usdc: "100.00",
    });

    mockGetBrandById.mockResolvedValue({
      id: "brand-123",
      owner_user_id: "different-user-id",
    });

    const res = await request(app).get("/challenges/challenge-123/deposit-info");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Forbidden");
  });

  it("should return 400 if challenge is not pending deposit", async () => {
    mockGetChallengeByIdAny.mockResolvedValue({
      id: "challenge-123",
      brand_id: "brand-123",
      status: "active",
      pool_amount_usdc: "100.00",
    });

    mockGetBrandById.mockResolvedValue({
      id: "brand-123",
      owner_user_id: "user-123",
    });

    const res = await request(app).get("/challenges/challenge-123/deposit-info");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not pending deposit");
  });

  it("should return deposit info for authorized brand owner with pending challenge", async () => {
    mockGetChallengeByIdAny.mockResolvedValue({
      id: "challenge-123",
      brand_id: "brand-123",
      status: "pending_deposit",
      pool_amount_usdc: "100.00",
    });

    mockGetBrandById.mockResolvedValue({
      id: "brand-123",
      owner_user_id: "user-123",
    });

    const res = await request(app).get("/challenges/challenge-123/deposit-info");

    expect(res.status).toBe(200);
    expect(res.body.depositInfo).toEqual({
      hotWalletAddress: "GHOTWALLETADDRESS",
      memo: "challenge-123",
      amount: "100.00",
    });
  });

  it("should not leak secrets in response for unauthorized users", async () => {
    mockGetChallengeByIdAny.mockResolvedValue({
      id: "challenge-123",
      brand_id: "brand-123",
      status: "pending_deposit",
      pool_amount_usdc: "100.00",
    });

    mockGetBrandById.mockResolvedValue({
      id: "brand-123",
      owner_user_id: "different-user-id",
    });

    const res = await request(app).get("/challenges/challenge-123/deposit-info");

    // Should not contain any deposit info
    expect(res.body.depositInfo).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("GHOTWALLETADDRESS");
    expect(JSON.stringify(res.body)).not.toContain("challenge-123");
  });
});
