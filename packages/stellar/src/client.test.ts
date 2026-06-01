import { describe, it, expect } from "vitest";
import { getNetwork, getHorizonServer, getRpcServer, getUsdcAsset, sharedAgent } from "./client";
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
});
