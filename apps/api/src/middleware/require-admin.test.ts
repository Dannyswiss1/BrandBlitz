import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../index";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-at-least-32-characters!!";

function token(role: string): string {
  return jwt.sign(
    { sub: "test-user", email: "test@example.com", role },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

describe("requireAdmin", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/admin/config/test-key");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const res = await request(app)
      .get("/admin/config/test-key")
      .set("Authorization", `Bearer ${token("player")}`);
    expect(res.status).toBe(403);
  });
});
