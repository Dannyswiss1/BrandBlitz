import express from "express";
import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { requireAdmin } from "./require-admin";

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-at-least-32-characters!!";

function token(role: string): string {
  return jwt.sign(
    { sub: "test-user", email: "test@example.com", role },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

describe("requireAdmin", () => {
  const app = express();
  app.use((req, _res, next) => {
    const header = req.get("Authorization");
    const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (bearer) {
      req.user = jwt.verify(bearer, JWT_SECRET) as typeof req.user;
    }
    next();
  });
  app.get("/admin/config/test-key", requireAdmin, (_req, res) => {
    res.json({ ok: true });
  });
  app.use(
    (
      err: { statusCode?: number; message?: string; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.statusCode ?? 500).json({ error: err.message, code: err.code });
    },
  );

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
