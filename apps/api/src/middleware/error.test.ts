import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BadRequestError } from "@stellar/stellar-sdk";
import { createError, errorHandler } from "./error";

// ── Module mocks ─────────────────────────────────────────────────────────────
// vi.hoisted() creates variables that are safe to reference inside vi.mock
// factories (they run before the factories, avoiding the TDZ problem).
const { captureExceptionSyncMock } = vi.hoisted(() => ({
  captureExceptionSyncMock: vi.fn(),
}));

// Prevent logger → config → process.exit chain when env vars are absent.
vi.mock("../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/sentry", () => ({
  captureExceptionSync: captureExceptionSyncMock,
}));

function makeRequest() {
  return {
    method: "POST",
    url: "/test",
  } as any;
}

function makeResponse() {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });

  return {
    locals: { requestId: "req-test-123" },
    status,
    json,
  } as any;
}

describe("error middleware", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it("createError produces an ApiError with the expected statusCode", () => {
    const error = createError("Not found", 404, "NOT_FOUND");

    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Not found");
  });

  it("returns 500 with Internal Server Error for unknown route errors in production", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();

    errorHandler(new Error("Boom"), req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal Server Error",
      requestId: "req-test-123",
    });
  });

  it("includes stack trace in development only", () => {
    const req = makeRequest();
    const res = makeResponse();
    const error = new Error("Crash");
    error.stack = "my-stack";

    process.env.NODE_ENV = "development";
    errorHandler(error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal Server Error",
      stack: "my-stack",
    });
  });

  it("strips stack trace in production responses", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const error = new Error("Crash");
    error.stack = "my-stack";

    errorHandler(error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal Server Error",
      requestId: "req-test-123",
    });
  });

  it("strips database error details from production 5xx responses", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const error = Object.assign(new Error("duplicate key violates unique constraint users_email_key"), {
      code: "23505",
      table: "users",
      column: "email",
      constraint: "users_email_key",
      stack: "db-stack",
    });

    errorHandler(error as any, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Internal Server Error",
      requestId: "req-test-123",
    });
  });

  it("maps ZodError to 400 with field-level details", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const schema = z.object({ email: z.string().email() });
    const parseResult = schema.safeParse({ email: 123 });

    expect(parseResult.success).toBe(false);
    if (parseResult.success) return;

    errorHandler(parseResult.error, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation Error",
        details: expect.any(Array),
      })
    );
    const payload = res.json.mock.calls[0][0];
    expect(payload.details[0]).toMatchObject({
      path: ["email"],
      message: expect.any(String),
      code: expect.any(String),
    });
  });

  it("maps Stellar BadRequestError to 400", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const error = new BadRequestError("Stellar bad request", null as any);

    errorHandler(error as any, req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Stellar bad request" });
  });
});

// ── Sentry reporting ─────────────────────────────────────────────────────────
describe("Sentry reporting in errorHandler", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    captureExceptionSyncMock.mockReset();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it("calls captureExceptionSync for 5xx errors", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const error = new Error("Database exploded");

    errorHandler(error, req, res, vi.fn());

    expect(captureExceptionSyncMock).toHaveBeenCalledOnce();
    expect(captureExceptionSyncMock).toHaveBeenCalledWith(
      error,
      { method: "POST", url: "/test" }
    );
  });

  it("does NOT call captureExceptionSync for 4xx client errors", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const error = createError("Bad input", 400, "BAD_INPUT");

    errorHandler(error, req, res, vi.fn());

    expect(captureExceptionSyncMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("does NOT call captureExceptionSync for ZodError (400)", () => {
    process.env.NODE_ENV = "production";
    const req = makeRequest();
    const res = makeResponse();
    const schema = z.object({ n: z.number() });
    const result = schema.safeParse({ n: "oops" });
    if (result.success) return;

    errorHandler(result.error, req, res, vi.fn());

    expect(captureExceptionSyncMock).not.toHaveBeenCalled();
  });

  it("calls captureExceptionSync in development for 5xx errors", () => {
    process.env.NODE_ENV = "development";
    const req = makeRequest();
    const res = makeResponse();
    const error = new Error("dev crash");

    errorHandler(error, req, res, vi.fn());

    expect(captureExceptionSyncMock).toHaveBeenCalledOnce();
    expect(captureExceptionSyncMock).toHaveBeenCalledWith(
      error,
      { method: "POST", url: "/test" }
    );
  });
});
