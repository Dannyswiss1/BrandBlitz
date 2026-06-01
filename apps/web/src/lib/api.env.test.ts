import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("API Base URL validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use http://localhost:3001/api when NEXT_PUBLIC_API_URL is missing in dev", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    (process.env as any).NODE_ENV = "development";
    
    // We import dynamically to test the top-level evaluation
    const { api } = await import("./api");
    expect(api.defaults.baseURL).toBe("http://localhost:3001/api");
  });

  it("should throw error if NEXT_PUBLIC_API_URL is missing in production", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    (process.env as any).NODE_ENV = "production";
    
    await expect(import("./api")).rejects.toThrow("NEXT_PUBLIC_API_URL is required in production");
  });

  it("should throw error if URL does not end with /api", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://example.com/wrong";
    
    await expect(import("./api")).rejects.toThrow("NEXT_PUBLIC_API_URL must end with /api");
  });

  it("should throw error if URL is invalid", async () => {
    process.env.NEXT_PUBLIC_API_URL = "not-a-valid-url";
    
    await expect(import("./api")).rejects.toThrow("NEXT_PUBLIC_API_URL must be a valid URL");
  });

  it("should create api client successfully with valid URL", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://example.com/api";
    
    const { api } = await import("./api");
    expect(api.defaults.baseURL).toBe("https://example.com/api");
  });
});
