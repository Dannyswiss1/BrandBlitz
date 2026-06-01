import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../index";

describe("requireHttps", () => {
  const origEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = origEnv;
  });

  it("allows http in non-production", async () => {
    process.env.NODE_ENV = "development";
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("rejects http behind proxy in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .get("/health")
      .set("x-forwarded-proto", "http");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("TLS required");
  });

  it("allows https behind proxy in production", async () => {
    process.env.NODE_ENV = "production";
    const res = await request(app)
      .get("/health")
      .set("x-forwarded-proto", "https");
    expect(res.status).toBe(200);
  });
});
