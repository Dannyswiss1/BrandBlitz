import express from "express";
import request from "supertest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { errorHandler } from "../../middleware/error";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getConfigRow: vi.fn(),
  setConfig: vi.fn(),
  adminUser: { sub: "admin-001", email: "admin@example.com", role: "admin" },
}));

vi.mock("../../db/queries/config", () => ({
  getConfig: mocks.getConfig,
  getConfigRow: mocks.getConfigRow,
  setConfig: mocks.setConfig,
}));

vi.mock("../../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = mocks.adminUser;
    next();
  },
}));

vi.mock("../../middleware/require-admin", () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

import configAdminRouter from "./config";

const app = express();
app.use(express.json());
app.use("/admin/config", configAdminRouter);
app.use(errorHandler);

describe("GET /admin/config/:key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns value, updated_at, and updated_by for an existing key", async () => {
    const now = new Date().toISOString();
    mocks.getConfigRow.mockResolvedValueOnce({
      key: "anti_cheat",
      value: { minReactionTimeMs: 150 },
      updated_at: now,
      updated_by: "admin-001",
    });

    const res = await request(app).get("/admin/config/anti_cheat");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      key: "anti_cheat",
      value: { minReactionTimeMs: 150 },
      updated_by: "admin-001",
    });
    expect(res.body.updated_at).toBeDefined();
  });

  it("returns updated_by as null when no admin has modified the key yet", async () => {
    const now = new Date().toISOString();
    mocks.getConfigRow.mockResolvedValueOnce({
      key: "payout",
      value: {},
      updated_at: now,
      updated_by: null,
    });

    const res = await request(app).get("/admin/config/payout");

    expect(res.status).toBe(200);
    expect(res.body.updated_by).toBeNull();
  });

  it("returns 404 for an unknown config key", async () => {
    mocks.getConfigRow.mockResolvedValueOnce(null);

    const res = await request(app).get("/admin/config/nonexistent");

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /admin/config/:key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls setConfig with the actor sub and returns updated value", async () => {
    const updatedRow = {
      key: "deposit_required_confirmations",
      value: { confirmations: 3 },
      updated_at: new Date().toISOString(),
      updated_by: "admin-001",
    };
    mocks.setConfig.mockResolvedValueOnce(undefined);
    mocks.getConfig.mockResolvedValueOnce(updatedRow.value);

    const res = await request(app)
      .patch("/admin/config/deposit_required_confirmations")
      .send({ value: { confirmations: 3 } });

    expect(res.status).toBe(200);
    expect(mocks.setConfig).toHaveBeenCalledWith(
      "deposit_required_confirmations",
      { confirmations: 3 },
      "admin-001"
    );
  });

  it("returns 400 for an unknown config key", async () => {
    const res = await request(app)
      .patch("/admin/config/unknown_key")
      .send({ value: { foo: "bar" } });

    expect(res.status).toBe(400);
  });
});
