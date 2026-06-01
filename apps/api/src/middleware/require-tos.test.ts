import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../index";
import { query } from "../db";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-at-least-32-characters!!";
const TEST_USER_ID = "00000000-0000-0000-0000-000000000002";
const TEST_EMAIL = "tos-test@example.com";

function token(): string {
  return jwt.sign(
    { sub: TEST_USER_ID, email: TEST_EMAIL, role: "player" },
    JWT_SECRET,
    { expiresIn: "15m" }
  );
}

describe("requireCurrentTosAccepted", () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO users (id, email, display_name, role)
       VALUES ($1, $2, 'TOS Test', 'player')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, TEST_EMAIL]
    );
  });

  it("blocks a user who has not accepted the current TOS", async () => {
    await query(
      `INSERT INTO legal_documents (version, type, body_markdown, effective_at)
       VALUES ('2.0', 'tos', '# New Terms', NOW() - INTERVAL '1 day')
       ON CONFLICT (type, version) DO NOTHING`
    );
    const res = await request(app)
      .post("/brands/challenges")
      .set("Authorization", `Bearer ${token()}`)
      .send({ brandId: "00000000-0000-0000-0000-000000000000", poolAmountUsdc: "10" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TOS_NOT_ACCEPTED");
  });

  it("passes after the user accepts the current TOS", async () => {
    await query(
      `INSERT INTO user_legal_acceptances (user_id, type, version, ip)
       VALUES ($1, 'tos', '2.0', '127.0.0.1')
       ON CONFLICT (user_id, type, version) DO NOTHING`,
      [TEST_USER_ID]
    );
    // The route will still check brand ownership, but the TOS middleware should pass
    const res = await request(app)
      .post("/brands/challenges")
      .set("Authorization", `Bearer ${token()}`)
      .send({ brandId: "00000000-0000-0000-0000-000000000000", poolAmountUsdc: "10" });
    expect(res.status).not.toBe(403);
  });
});
