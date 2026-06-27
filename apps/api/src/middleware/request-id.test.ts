import { describe, it, expect, vi } from "vitest";
import { requestId } from "./request-id";

function mockReq(existingId?: string) {
  return {
    headers: existingId ? { "x-request-id": existingId } : {},
  } as any;
}

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    locals: {} as Record<string, unknown>,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
    getHeader: (name: string) => headers[name],
  } as any;
}

describe("requestId middleware", () => {
  it("generates a UUID when no X-Request-ID header is present", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    requestId(req, res, next);

    expect(res.locals.requestId).toBeDefined();
    expect(res.locals.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Request-ID",
      res.locals.requestId
    );
    expect(next).toHaveBeenCalled();
  });

  it("preserves an existing valid X-Request-ID header", () => {
    const existingId = "550e8400-e29b-41d4-a716-446655440000";
    const req = mockReq(existingId);
    const res = mockRes();
    const next = vi.fn();

    requestId(req, res, next);

    expect(res.locals.requestId).toBe(existingId);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", existingId);
    expect(next).toHaveBeenCalled();
  });

  it("echoes X-Request-ID response header", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    requestId(req, res, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Request-ID",
      res.locals.requestId
    );
  });
});
