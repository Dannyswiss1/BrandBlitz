import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();
const mockGetPublicUrl = vi.fn((bucket: string, key: string) => `https://public/${bucket}/${key}`);

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisDel = vi.fn();

vi.mock("../middleware/authenticate", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { sub: "user-123", email: "test@example.com" };
    return next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    req.user = { sub: "user-123", email: "test@example.com" };
    return next();
  },
}));

vi.mock("../middleware/rate-limit", () => ({
  apiLimiter: (_req: any, _res: any, next: any) => next(),
  authLimiter: (_req: any, _res: any, next: any) => next(),
  challengeStartLimiter: (_req: any, _res: any, next: any) => next(),
  uploadLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@brandblitz/storage", () => ({
  s3: { send: mockSend },
  BUCKETS: {
    BRAND_ASSETS: "brand-assets",
    SHARE_CARDS: "share-cards",
  },
  getPublicUrl: mockGetPublicUrl,
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock("../lib/redis", () => ({
  redis: {
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  },
}));

import { errorHandler } from "../middleware/error";

let app: express.Express;
let registerRoutes: (app: express.Express) => void;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const routes = await import("../routes");
  registerRoutes = routes.registerRoutes;
  registerRoutes(app);
  app.use(errorHandler);
});

beforeEach(() => {
  vi.resetAllMocks();
  // Default: Redis set/del succeed silently
  mockRedisSet.mockResolvedValue("OK");
  mockRedisDel.mockResolvedValue(1);
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("upload routes integration", () => {
  it("POST /upload/presign returns signed URL and public URL for valid brand-logo uploads", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed-url");

    const response = await request(app)
      .post("/upload/presign")
      .send({
        type: "brand-logo",
        contentType: "image/png",
        contentLength: 1024 * 1024,
      })
      .expect(200);

    expect(response.body).toEqual({
      uploadUrl: "https://signed-url",
      key: expect.stringMatching(/^logos\/[\w-]{36}$/),
      publicUrl: expect.stringContaining("https://public/brand-assets/logos/"),
      expiresIn: 60,
    });
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);

    const command = mockGetSignedUrl.mock.calls[0][1];
    expect(command.input).toMatchObject({
      Bucket: "brand-assets",
      ContentType: "image/png",
      Key: response.body.key,
    });

    expect(mockGetPublicUrl).toHaveBeenCalledWith(
      "brand-assets",
      response.body.key
    );

    // Ownership record must be created in Redis
    expect(mockRedisSet).toHaveBeenCalledOnce();
    const [redisKey, , , ttl] = mockRedisSet.mock.calls[0];
    expect(redisKey).toContain(`user-123:${response.body.key}`);
    expect(ttl).toBeGreaterThan(0);
  });

  it("POST /upload/presign rejects disallowed MIME types with 400", async () => {
    const response = await request(app)
      .post("/upload/presign")
      .send({
        type: "brand-logo",
        contentType: "image/gif",
        contentLength: 1024,
      })
      .expect(400);

    expect(response.body.error).toBe("Validation Error");
  });

  it("POST /upload/presign rejects oversize contentLength with 400", async () => {
    const response = await request(app)
      .post("/upload/presign")
      .send({
        type: "brand-logo",
        contentType: "image/png",
        contentLength: 3 * 1024 * 1024,
      })
      .expect(400);

    expect(response.body.error).toBe(
      "Content length exceeds maximum of 2MB for brand-logo"
    );
  });

  it("POST /upload/verify returns 200 when the object exists and MIME matches", async () => {
    // HeadObject → ContentType: image/png
    mockSend.mockResolvedValueOnce({ ContentType: "image/png" });
    // GetObject Range → PNG magic bytes
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockSend.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => pngMagic },
    });

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/test-key" })
      .expect(200);

    expect(response.body).toEqual({
      exists: true,
      publicUrl: "https://public/brand-assets/logos/test-key",
    });
    expect(mockSend.mock.calls[0][0]?.input).toMatchObject({
      Bucket: "brand-assets",
      Key: "logos/test-key",
    });
    // Ownership record must be cleared after successful verify
    expect(mockRedisDel).toHaveBeenCalledOnce();
  });

  it("POST /upload/verify returns 404 when the object does not exist", async () => {
    mockSend.mockRejectedValueOnce(new Error("Not found"));

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/test-key" })
      .expect(404);

    expect(response.body.error).toBe("File not found in storage");
  });

  // ── MIME magic-byte validation ─────────────────────────────────────────────

  it("POST /upload/verify returns 200 for a valid PNG (magic bytes match)", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/png" });
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockSend.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => pngMagic },
    });

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/valid.png" })
      .expect(200);

    expect(response.body.exists).toBe(true);
  });

  it("POST /upload/verify returns 400 and deletes when magic bytes mismatch declared MIME", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/png" });
    // JPEG magic bytes — mismatch with declared image/png
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    mockSend.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => jpegMagic },
    });
    mockSend.mockResolvedValueOnce({}); // DeleteObject

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/bad.png" })
      .expect(400);

    expect(response.body.error).toBe("File content does not match declared content type");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("POST /upload/verify returns 400 and deletes SVG containing <script>", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/evil.svg" })
      .expect(400);

    expect(response.body.error).toBe("SVG contains disallowed content");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it("POST /upload/verify returns 400 for SVG with event handler (onload=)", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/onload.svg" })
      .expect(400);

    expect(response.body.error).toBe("SVG contains disallowed content");
  });

  it("POST /upload/verify returns 400 for SVG with javascript: URI", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>click</text></a></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/jsuri.svg" })
      .expect(400);

    expect(response.body.error).toBe("SVG contains disallowed content");
  });

  it("POST /upload/verify returns 400 for SVG with <foreignObject>", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body onload="alert(1)"/></foreignObject></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/foreign.svg" })
      .expect(400);

    expect(response.body.error).toBe("SVG contains disallowed content");
  });

  it("POST /upload/verify returns 400 for SVG with entity-encoded javascript: URI", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><a href="&#106;avascript:alert(1)"><text>x</text></a></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/encoded.svg" })
      .expect(400);

    expect(response.body.error).toBe("SVG contains disallowed content");
  });

  it("POST /upload/verify returns 400 for SVG with data: href", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml,<svg onload=alert(1)/>"/></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });
    mockSend.mockResolvedValueOnce({});

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/datauri.svg" })
      .expect(400);

    expect(response.body.error).toBe("SVG contains disallowed content");
  });

  it("POST /upload/verify returns 200 for a valid SVG without dangerous content", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/svg+xml" });
    const svgContent = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="#6366f1"/></svg>');
    mockSend.mockResolvedValueOnce({ Body: { transformToByteArray: async () => svgContent } });

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/clean.svg" })
      .expect(200);

    expect(response.body.exists).toBe(true);
  });

  it("POST /upload/verify returns 200 for a valid JPEG", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "image/jpeg" });
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    mockSend.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => jpegMagic },
    });

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "avatars/photo.jpg" })
      .expect(200);

    expect(response.body.exists).toBe(true);
  });

  it("POST /upload/verify returns 400 and deletes when declared MIME is not in the allow-list", async () => {
    mockSend.mockResolvedValueOnce({ ContentType: "application/pdf" });
    mockSend.mockResolvedValueOnce({}); // DeleteObject

    const response = await request(app)
      .post("/upload/verify")
      .send({ key: "logos/document.pdf" })
      .expect(400);

    expect(response.body.error).toBe("Declared content type is not allowed");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // ── Orphan abort (issue #161) ──────────────────────────────────────────────

  it("DELETE /upload/abort deletes the object and returns 204 when caller owns the key", async () => {
    mockRedisGet.mockResolvedValueOnce("1"); // ownership confirmed
    mockSend.mockResolvedValueOnce({});

    await request(app)
      .delete("/upload/abort")
      .send({ key: "logos/orphan-key" })
      .expect(204);

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0]?.input).toMatchObject({
      Bucket: "brand-assets",
      Key: "logos/orphan-key",
    });
    // Ownership record must be removed after successful delete
    expect(mockRedisDel).toHaveBeenCalledOnce();
  });

  it("DELETE /upload/abort targets the correct bucket for avatars/", async () => {
    mockRedisGet.mockResolvedValueOnce("1");
    mockSend.mockResolvedValueOnce({});

    await request(app)
      .delete("/upload/abort")
      .send({ key: "avatars/orphan-key" })
      .expect(204);

    expect(mockSend.mock.calls[0][0]?.input).toMatchObject({
      Bucket: "brand-assets",
      Key: "avatars/orphan-key",
    });
  });

  it("DELETE /upload/abort returns 403 when the caller did not create the key (IDOR guard)", async () => {
    mockRedisGet.mockResolvedValueOnce(null); // no ownership record

    const response = await request(app)
      .delete("/upload/abort")
      .send({ key: "logos/someone-elses-key" })
      .expect(403);

    expect(response.body.error).toBe("Not authorised to abort this upload");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("DELETE /upload/abort returns 400 when key is missing", async () => {
    const response = await request(app)
      .delete("/upload/abort")
      .send({})
      .expect(400);

    expect(response.body.error).toBe("Validation Error");
  });
});
