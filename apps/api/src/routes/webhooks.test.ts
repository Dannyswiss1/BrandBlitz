import type { Server } from "node:http";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { errorHandler } from "../middleware/error";
import webhooksRouter from "./webhooks";

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getChallengeByMemo: vi.fn(),
  getChallengeByDepositTxHash: vi.fn(),
  updateChallengeStatus: vi.fn(),
  findPayoutByTxHash: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  redisCall: vi.fn(),
  getAccountUsdcBalance: vi.fn(),
}));

vi.mock("../db/queries/challenges", () => ({
  getChallengeByMemo: mocks.getChallengeByMemo,
  getChallengeByDepositTxHash: mocks.getChallengeByDepositTxHash,
  updateChallengeStatus: mocks.updateChallengeStatus,
}));

vi.mock("../db/queries/payouts", () => ({
  findPayoutByTxHash: mocks.findPayoutByTxHash,
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  webhookLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock("../lib/redis", () => ({
  redis: { call: mocks.redisCall },
}));

vi.mock("@brandblitz/stellar", () => ({
  getAccountUsdcBalance: mocks.getAccountUsdcBalance,
}));

// ── Test server helpers ────────────────────────────────────────────────────────

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  app.use("/webhooks", webhooksRouter);
  app.use(errorHandler);

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test server");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

function createWebhookHeaders(body: object, override?: Partial<Record<string, string>>) {
  const payload = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWebhookPayload(payload, Number(timestamp));
  const defaultId = `test-webhook-id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    "x-webhook-secret": WEBHOOK_SECRET,
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": `sha256=${signature}`,
    "x-webhook-id": override?.["x-webhook-id"] ?? defaultId,
    ...override,
  };
}

describe("Webhooks API", () => {
  let currentServer: Server | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getChallengeByMemo.mockResolvedValue({
      id: "challenge-1",
      status: "pending_deposit",
      pool_amount_usdc: "10.0000000",
    });
    mocks.getChallengeByDepositTxHash.mockResolvedValue(null);
    mocks.findPayoutByTxHash.mockResolvedValue(null);
    mocks.updateChallengeStatus.mockResolvedValue(undefined);
    mocks.getAccountUsdcBalance.mockResolvedValue(10_000_0000n);
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

  describe("POST /webhooks/stellar/deposit", () => {
    it("activates a challenge on a valid webhook", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "a".repeat(64),
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(200);
      expect(mocks.updateChallengeStatus).toHaveBeenCalledWith("challenge-1", "active", {
        depositTx: "a".repeat(64),
      });
    });

    it("is idempotent for already active challenges", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      mocks.getChallengeByMemo.mockResolvedValue({ id: "challenge-1", status: "active" });

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "a".repeat(64),
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(200);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown memo", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      mocks.getChallengeByMemo.mockResolvedValue(null);

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "a".repeat(64),
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(404);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("returns 200 and no-ops for duplicate tx hashes", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;
      mocks.getChallengeByDepositTxHash.mockResolvedValue({ id: "challenge-older" });

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "b".repeat(64),
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(200);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("rejects the wrong shared secret", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "wrong-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "a".repeat(64),
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(401);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("returns 400 for missing required fields", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          // txHash intentionally omitted
        }),
      });

      expect(response.status).toBe(400);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("rejects an empty memo", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "",
          txHash: "a".repeat(64),
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(400);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("rejects an empty tx hash", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "",
          amount: "10.0000000",
        }),
      });

      expect(response.status).toBe(400);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });

    it("rejects unknown fields", async () => {
      const { server, baseUrl } = await startServer();
      currentServer = server;

      const response = await fetch(`${baseUrl}/webhooks/stellar/deposit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": "test-webhook-secret",
        },
        body: JSON.stringify({
          memo: "550e8400-e29b-41d4-a716-446655440000",
          txHash: "a".repeat(64),
          amount: "10.0000000",
          extra: "unexpected",
        }),
      });

      expect(response.status).toBe(400);
      expect(mocks.updateChallengeStatus).not.toHaveBeenCalled();
    });
  });
});
