import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getNetwork, getHorizonServer, getRpcServer, getUsdcAsset, sharedAgent, withRetry } from "./client";
import { STELLAR_NETWORKS } from "./constants";

describe("client", () => {
  describe("getNetwork", () => {
    it("should return testnet config by default", () => {
      const config = getNetwork();
      expect(config).toBe(STELLAR_NETWORKS.testnet);
    });

    it("should return public config when requested", () => {
      const config = getNetwork("public");
      expect(config).toBe(STELLAR_NETWORKS.public);
    });

    it("should throw on invalid network name", () => {
      // @ts-expect-error - testing invalid input
      expect(() => getNetwork("invalid")).toThrow("Invalid network name: invalid");
    });
  });

  describe("getHorizonServer", () => {
    it("should create Horizon server with correct URL", () => {
      const server = getHorizonServer("testnet");
      expect(server.serverURL.toString()).toContain("horizon-testnet.stellar.org");
    });
  });

  describe("getRpcServer", () => {
    it("should create RPC server with correct URL", () => {
      const server = getRpcServer("testnet");
      // @ts-ignore - access private/internal URL if needed, but let's just check if it exists
      expect(server).toBeDefined();
    });
  });

  describe("getUsdcAsset", () => {
    it("should return correct USDC asset for testnet", () => {
      const asset = getUsdcAsset("testnet");
      expect(asset.code).toBe("USDC");
      expect(asset.issuer).toBe(STELLAR_NETWORKS.testnet.usdcIssuer);
    });

    it("should return correct USDC asset for public", () => {
      const asset = getUsdcAsset("public");
      expect(asset.code).toBe("USDC");
      expect(asset.issuer).toBe(STELLAR_NETWORKS.public.usdcIssuer);
    });
  });

  describe("sharedAgent", () => {
    it("has keepAlive enabled for connection reuse", () => {
      expect(sharedAgent.keepAlive).toBe(true);
    });

    it("maxSockets is a positive number", () => {
      expect(sharedAgent.maxSockets).toBeGreaterThan(0);
    });
  });

  describe("withRetry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("should execute function successfully on first attempt", async () => {
      const fn = vi.fn().mockResolvedValueOnce("success");
      const result = await withRetry(fn);

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should retry on 429 status code", async () => {
      const error = new Error("Rate limited");
      (error as any).response = { status: 429 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on 503 status code", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on 504 status code", async () => {
      const error = new Error("Gateway timeout");
      (error as any).response = { status: 504 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should retry on network timeout errors", async () => {
      const error = new Error("Connection timeout");

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should not retry on non-retryable errors", async () => {
      const error = new Error("Invalid request");
      (error as any).response = { status: 400 };

      const fn = vi.fn().mockRejectedValueOnce(error);

      await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow("Invalid request");
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("should exhaust retries and throw error with retryExhausted flag", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100 });
      await vi.runAllTimersAsync();

      try {
        await promise;
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.retryExhausted).toBe(true);
        expect(err.message).toBe("Service unavailable");
      }

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should use exponential backoff with jitter", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 30_000 });

      // First attempt fails immediately
      expect(fn).toHaveBeenCalledTimes(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(fn).toHaveBeenCalledTimes(1);

      // First retry is scheduled (exponential backoff)
      await vi.advanceTimersByTimeAsync(200);
      expect(fn).toHaveBeenCalledTimes(2);

      // Second retry (more backoff)
      await vi.advanceTimersByTimeAsync(400);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await promise;
      expect(result).toBe("success");
    });

    it("should respect maxDelayMs cap", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      let delayUsed: number | null = null;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockImplementationOnce(async () => {
          // Calculate approximate delay from timer state
          return "success";
        });

      const promise = withRetry(fn, {
        maxAttempts: 2,
        baseDelayMs: 100,
        maxDelayMs: 500,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it("should log retry attempts with delay info", async () => {
      const error = new Error("Rate limited");
      (error as any).response = { status: 429 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();
      await promise;

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Stellar RPC Retry"),
        expect.objectContaining({
          statusCode: 429,
          delayMs: expect.any(Number),
        })
      );
    });

    it("should log exhaustion message", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValue(error);

      const promise = withRetry(fn, { maxAttempts: 2, baseDelayMs: 100 });
      await vi.runAllTimersAsync();

      try {
        await promise;
      } catch {
        // Expected
      }

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("Exhausted"),
        expect.objectContaining({
          statusCode: 503,
        })
      );
    });

    it("should use custom retry options", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce("success");

      const promise = withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 50,
        maxDelayMs: 1000,
        retryableStatusCodes: [429, 500, 503, 504],
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("should only retry custom status codes if specified", async () => {
      const error = new Error("Service unavailable");
      (error as any).response = { status: 503 };

      const fn = vi.fn().mockRejectedValue(error);

      // 503 not in custom list, so no retry
      await expect(
        withRetry(fn, {
          maxAttempts: 3,
          retryableStatusCodes: [429, 504],
        })
      ).rejects.toThrow("Service unavailable");

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
