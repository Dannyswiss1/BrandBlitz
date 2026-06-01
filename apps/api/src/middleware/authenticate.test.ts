import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import {
  authenticate,
  authenticateOptional,
  tokenRevocationKey,
} from "./authenticate";

const SECRET = "test_secret_test_secret_test_secret_123";

const mocks = vi.hoisted(() => ({
  redisGet: vi.fn(),
}));

vi.mock("../lib/config", () => ({
  config: {
    JWT_SECRET: "test_secret_test_secret_test_secret_123",
  },
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mocks.redisGet,
  },
}));

function mockReq(token?: string) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined as any,
  };
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const next = vi.fn();

function signToken(payload: any, options = {}) {
  return jwt.sign(payload, SECRET, options);
}

describe("authenticate middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue(null);
  });

  it("accepts a valid bearer token", async () => {
    const token = signToken({ sub: "user1", email: "user@example.com" }, { expiresIn: "1h" });
    const req = mockReq(token);
    const res = mockRes();

    await authenticate(req as any, res, next);

    expect(req.user.sub).toBe("user1");
    expect(mocks.redisGet).toHaveBeenCalledWith(tokenRevocationKey(token));
    expect(next).toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const req = mockReq();
    const res = mockRes();

    await authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects a revoked token", async () => {
    const token = signToken({ sub: "user1", email: "user@example.com" }, { expiresIn: "1h" });
    const req = mockReq(token);
    const res = mockRes();
    mocks.redisGet.mockResolvedValue("1");

    await authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", async () => {
    const req = mockReq("invalid_token");
    const res = mockRes();

    await authenticate(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("authenticateOptional middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redisGet.mockResolvedValue(null);
  });

  it("sets req.user for a valid non-revoked token", async () => {
    const token = signToken({ sub: "user1", email: "user@example.com" }, { expiresIn: "1h" });
    const req = mockReq(token);
    const res = mockRes();

    await authenticateOptional(req as any, res, next);

    expect(req.user.sub).toBe("user1");
    expect(next).toHaveBeenCalled();
  });

  it("continues without user for a revoked optional token", async () => {
    const token = signToken({ sub: "user1", email: "user@example.com" }, { expiresIn: "1h" });
    const req = mockReq(token);
    const res = mockRes();
    mocks.redisGet.mockResolvedValue("1");

    await authenticateOptional(req as any, res, next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});
