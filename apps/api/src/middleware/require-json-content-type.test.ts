import { describe, it, expect, vi } from "vitest";
import { requireJsonContentType } from "./require-json-content-type";

function mockReq(method: string, path: string, contentType?: string) {
  return {
    method,
    path,
    headers: contentType ? { "content-type": contentType } : {},
    is: (type: string) => {
      const ct = contentType ?? "";
      return ct.startsWith(type) || ct.startsWith(`${type};`);
    },
  } as any;
}

function mockRes() {
  return {} as any;
}

describe("requireJsonContentType", () => {
  it("allows GET requests without content-type", () => {
    const req = mockReq("GET", "/test");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows DELETE requests without content-type", () => {
    const req = mockReq("DELETE", "/test");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows OPTIONS requests without content-type", () => {
    const req = mockReq("OPTIONS", "/test");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows POST with application/json", () => {
    const req = mockReq("POST", "/test", "application/json");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows POST with application/json; charset=utf-8", () => {
    const req = mockReq("POST", "/test", "application/json; charset=utf-8");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects POST with text/plain", () => {
    const req = mockReq("POST", "/test", "text/plain");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 415 }));
  });

  it("rejects POST with multipart/form-data", () => {
    const req = mockReq("POST", "/test", "multipart/form-data");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 415 }));
  });

  it("rejects POST with missing content-type header", () => {
    const req = mockReq("POST", "/test");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 415 }));
  });

  it("allows POST on /upload routes even without content-type", () => {
    const req = mockReq("POST", "/upload/presign");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects PATCH with mismatched content-type", () => {
    const req = mockReq("PATCH", "/test", "text/xml");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 415 }));
  });

  it("allows PUT with application/json", () => {
    const req = mockReq("PUT", "/test", "application/json");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it("allows POST on /upload/verify route", () => {
    const req = mockReq("POST", "/upload/verify", "text/plain");
    const next = vi.fn();
    requireJsonContentType(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith();
  });
});
