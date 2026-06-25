import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateReactionTime, validateDeviceFingerprint, enforceOneSessionPerChallenge, BOT_REACTION_THRESHOLD_MS, MIN_HUMAN_REACTION_MS, validateRoundScore, assertValidTotalScore } from "./anti-cheat";
import * as fraudQueries from "../db/queries/fraud-flags";
import { metrics } from "../lib/metrics";
import * as sessionQueries from "../db/queries/sessions";

vi.mock("../db/queries/fraud-flags");
vi.mock("../db/queries/sessions");
vi.mock("../lib/redis", () => ({
  redis: {
    sadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    scard: vi.fn().mockResolvedValue(1),
    get: vi.fn(),
    set: vi.fn(),
  },
}));
vi.mock("../lib/metrics", () => ({
  metrics: { inc: vi.fn() }
}));
vi.mock("../lib/fingerprint", () => ({
  computeFingerprint: vi.fn().mockReturnValue("test-fingerprint-hash"),
}));

import { redis } from "../lib/redis";
import { computeFingerprint } from "../lib/fingerprint";

describe("anti-cheat middleware", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      body: {},
      user: { sub: "user-1" },
      params: { challengeId: "challenge-1" },
      headers: {
        "x-device-id": "device-abc",
      },
      ip: "1.2.3.4",
      sessionId: "session-1"
    };
    res = {};
    next = vi.fn();
    vi.clearAllMocks();
    (computeFingerprint as any).mockReturnValue("test-fingerprint-hash");
    (redis.sadd as any).mockResolvedValue(1);
    (redis.expire as any).mockResolvedValue(1);
    (redis.scard as any).mockResolvedValue(1);
  });

  describe("validateReactionTime", () => {
    it("blocks with 403 if reaction time is below bot threshold", async () => {
      req.body.reactionTimeMs = BOT_REACTION_THRESHOLD_MS - 1;

      await expect(validateReactionTime(req, res, next)).rejects.toMatchObject({
        statusCode: 403,
        code: "REACTION_IMPOSSIBLE"
      });

      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
      expect(metrics.inc).toHaveBeenCalledWith("antiCheat.flags_total", expect.objectContaining({ severity: "critical" }));
    });

    it("flags but allows if reaction time is between bot and human minimum", async () => {
      req.body.reactionTimeMs = MIN_HUMAN_REACTION_MS - 10;

      await validateReactionTime(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
      expect(metrics.inc).toHaveBeenCalledWith("antiCheat.flags_total", expect.objectContaining({ severity: "warning" }));
    });

    it("flags with info severity if reaction time is above maximum", async () => {
      req.body.reactionTimeMs = 35000;

      await validateReactionTime(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
      expect(metrics.inc).toHaveBeenCalledWith("antiCheat.flags_total", expect.objectContaining({ severity: "info" }));
    });
  });

  describe("validateDeviceFingerprint", () => {
    it("rejects with 400 when neither x-device-id nor x-visitor-id is provided", async () => {
      req.headers = {};

      await expect(validateDeviceFingerprint(req, res, next)).rejects.toMatchObject({
        statusCode: 400,
        code: "MISSING_DEVICE_ID",
      });
    });

    it("passes and calls next when fingerprint has <3 accounts", async () => {
      (redis.scard as any).mockResolvedValue(2);

      await validateDeviceFingerprint(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(metrics.inc).not.toHaveBeenCalledWith("antiCheat.fingerprint_collision_total", expect.anything());
    });

    it("rejects with 403 FINGERPRINT_COLLISION when fingerprint has >=3 accounts", async () => {
      (redis.scard as any).mockResolvedValue(3);

      await expect(validateDeviceFingerprint(req, res, next)).rejects.toMatchObject({
        statusCode: 403,
        code: "FINGERPRINT_COLLISION",
      });

      expect(metrics.inc).toHaveBeenCalledWith(
        "antiCheat.fingerprint_collision_total",
        expect.objectContaining({ fingerprint: expect.any(String) })
      );
    });

    it("combines x-visitor-id and x-device-id in the fingerprint", async () => {
      req.headers["x-visitor-id"] = "fp-visitor-id";
      (redis.scard as any).mockResolvedValue(1);

      await validateDeviceFingerprint(req, res, next);

      expect(computeFingerprint).toHaveBeenCalledWith(
        expect.objectContaining({
          visitorId: "fp-visitor-id",
          deviceId: "device-abc",
        })
      );
    });

    it("normalizes IPv6 addresses before computing the fingerprint", async () => {
      req.ip = "2001:db8:abcd:ef12::1234";
      (redis.scard as any).mockResolvedValue(1);

      await validateDeviceFingerprint(req, res, next);

      expect(computeFingerprint).toHaveBeenCalledWith(
        expect.objectContaining({
          ip: "2001:db8:abcd:ef12::/64",
        })
      );
    });

    it("calls next without checking Redis when there is no authenticated user", async () => {
      req.user = undefined;

      await validateDeviceFingerprint(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(redis.sadd).not.toHaveBeenCalled();
    });

    it("fails open when Redis is unavailable", async () => {
      (redis.sadd as any).mockRejectedValue(new Error("Redis down"));

      await validateDeviceFingerprint(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("enforceOneSessionPerChallenge", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("attaches new session to req and calls next when claimSession succeeds", async () => {
      const mockSession = { id: "s1", user_id: "user-1", challenge_id: "challenge-1" };
      (sessionQueries.claimSession as any).mockResolvedValue(mockSession);

      await enforceOneSessionPerChallenge(req, res, next);

      expect(sessionQueries.claimSession).toHaveBeenCalledWith({
        userId: "user-1",
        challengeId: "challenge-1",
        deviceId: "device-abc",
        isPractice: false,
      });
      expect((req as any).session).toEqual(mockSession);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("fetches existing session on conflict and attaches it to req", async () => {
      (sessionQueries.claimSession as any).mockResolvedValue(null);
      const existing = { id: "s1", user_id: "user-1", challenge_id: "challenge-1" };
      (sessionQueries.getSession as any).mockResolvedValue(existing);

      await enforceOneSessionPerChallenge(req, res, next);

      expect(sessionQueries.getSession).toHaveBeenCalledWith("user-1", "challenge-1");
      expect((req as any).session).toEqual(existing);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("throws 404 when claimSession fails AND no existing session found", async () => {
      (sessionQueries.claimSession as any).mockResolvedValue(null);
      (sessionQueries.getSession as any).mockResolvedValue(null);

      await expect(enforceOneSessionPerChallenge(req, res, next)).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("validateRoundScore", () => {
    it("calls next when roundScore is not in body", async () => {
      req.body = {};
      await validateRoundScore(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("calls next for valid roundScore = 0", async () => {
      req.body.roundScore = 0;
      await validateRoundScore(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("calls next for valid roundScore = 150", async () => {
      req.body.roundScore = 150;
      await validateRoundScore(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("rejects with 422 when roundScore = 151", async () => {
      req.body.roundScore = 151;
      await expect(validateRoundScore(req, res, next)).rejects.toMatchObject({
        statusCode: 422,
        code: "ROUND_SCORE_OUT_OF_RANGE",
      });
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
    });

    it("rejects with 422 when roundScore = -1", async () => {
      req.body.roundScore = -1;
      await expect(validateRoundScore(req, res, next)).rejects.toMatchObject({
        statusCode: 422,
        code: "ROUND_SCORE_OUT_OF_RANGE",
      });
      expect(fraudQueries.createFraudFlag).toHaveBeenCalled();
    });
  });

  describe("assertValidTotalScore", () => {
    it("does not throw for score = 0", () => {
      expect(() => assertValidTotalScore(0)).not.toThrow();
    });

    it("does not throw for score = 450", () => {
      expect(() => assertValidTotalScore(450)).not.toThrow();
    });

    it("throws 422 for score = 451", () => {
      expect(() => assertValidTotalScore(451)).toThrow();
      try {
        assertValidTotalScore(451);
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe("TOTAL_SCORE_OUT_OF_RANGE");
      }
    });

    it("throws 422 for score = -1", () => {
      expect(() => assertValidTotalScore(-1)).toThrow();
      try {
        assertValidTotalScore(-1);
      } catch (err: any) {
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe("TOTAL_SCORE_OUT_OF_RANGE");
      }
    });
  });
});
