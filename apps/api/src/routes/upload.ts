import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, BUCKETS, getPublicUrl } from "@brandblitz/storage";
import { redis } from "../lib/redis";
import { authenticate } from "../middleware/authenticate";
import { uploadLimiter } from "../middleware/rate-limit";
import { createError } from "../middleware/error";

/** Redis key that proves a user owns a pending upload. TTL must outlive the
 *  presign window (60 s) plus the verify-retry window (~1.7 s × 3). 300 s is
 *  a generous but bounded limit — orphans not aborted within 5 min are swept
 *  by the server-side reaper (see docs/13-file-storage.md). */
const PENDING_UPLOAD_TTL_SECONDS = 300;

function pendingUploadKey(userId: string, s3Key: string): string {
  return `upload:pending:${userId}:${s3Key}`;
}

const router = Router();

const ALLOWED_UPLOAD_TYPES = {
  "brand-logo":    { bucket: BUCKETS.BRAND_ASSETS, prefix: "logos/",    maxMb: 2 },
  "product-image": { bucket: BUCKETS.BRAND_ASSETS, prefix: "products/", maxMb: 5 },
  "user-avatar":   { bucket: BUCKETS.BRAND_ASSETS, prefix: "avatars/",  maxMb: 1 },
} as const;

const ALLOWED_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

type AllowedMime = typeof ALLOWED_CONTENT_TYPES[number];

const PresignSchema = z.object({
  type: z.enum(["brand-logo", "product-image", "user-avatar"]),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  contentLength: z.number().int().positive(),
});

/**
 * Detect MIME type from the first bytes of a buffer using magic numbers.
 * Returns one of the four allowed MIME strings, or null if unrecognised.
 */
function detectMime(buf: Buffer): AllowedMime | null {
  if (buf.length < 3) return null;

  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WebP: "RIFF" at 0-3 and "WEBP" at 8-11
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // SVG: XML or SVG text (after optional BOM / whitespace)
  const text = buf.toString("utf8", 0, Math.min(buf.length, 128)).trimStart();
  if (text.startsWith("<svg") || text.startsWith("<?xml") || text.startsWith("<!DOCTYPE svg")) {
    return "image/svg+xml";
  }

  return null;
}

/**
 * Decode common XML/HTML character references so encoded payloads like
 * `&#106;avascript:` or `&#x6A;avascript:` are normalised before scanning.
 * Only decodes numeric references; named references (&amp; etc.) that
 * are safe in SVG attribute values are left intact.
 */
function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    );
}

/**
 * SVG XSS patterns applied after entity decoding.
 *
 * Blocklist limitations are acknowledged: XML namespace tricks,
 * CSS-based attacks in <style>, and novel parser differentials are not
 * covered here. For full mitigation, serve user-uploaded SVGs from a
 * separate cookieless origin with `Content-Disposition: attachment` and
 * `Content-Security-Policy: default-src 'none'; sandbox`.
 */
const SVG_DANGEROUS_PATTERNS: RegExp[] = [
  /<script/i,
  /\bon\w+\s*=/i,                               // event handlers (onload=, onerror=, …)
  /javascript\s*:/i,                             // javascript: URIs
  /vbscript\s*:/i,                               // vbscript: URIs (IE legacy)
  /<foreignObject/i,                             // HTML namespace embedding
  /\bhref\s*=\s*["']?\s*data\s*:/i,             // data: URIs in any href
  /\bsrc\s*=\s*["']?\s*data\s*:/i,              // data: URIs in any src
  /\baction\s*=\s*["']?\s*data\s*:/i,           // data: URIs in form action
  /<use[^>]+(?:xlink:)?href\s*=\s*["']https?:/i, // external <use> references
];

function isSvgSafe(rawContent: string): boolean {
  const content = decodeXmlEntities(rawContent);
  return !SVG_DANGEROUS_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * POST /upload/presign
 * Generate a presigned PUT URL for direct client → storage upload.
 * Files NEVER pass through the API server — no memory pressure.
 */
router.post("/presign", authenticate, uploadLimiter, async (req, res) => {
  const { type, contentType, contentLength } = PresignSchema.parse(req.body);

  const config = ALLOWED_UPLOAD_TYPES[type];
  if (contentLength > config.maxMb * 1024 * 1024) {
    throw createError(
      `Content length exceeds maximum of ${config.maxMb}MB for ${type}`,
      400
    );
  }

  const key = `${config.prefix}${randomUUID()}`;

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

  // Record ownership so /abort can verify the caller created this key
  await redis.set(
    pendingUploadKey(req.user!.sub, key),
    "1",
    "EX",
    PENDING_UPLOAD_TTL_SECONDS
  );

  res.json({
    uploadUrl,
    key,
    publicUrl: getPublicUrl(config.bucket, key),
    expiresIn: 60,
  });
});

/**
 * POST /upload/verify
 * Verify a file was actually uploaded and its content matches the declared MIME type.
 *
 * For binary formats (PNG/JPEG/WebP): reads the first 16 bytes via a Range
 * request and validates magic bytes against the declared ContentType.
 *
 * For SVG: fetches the complete file content (bounded by the 2 MB presign limit)
 * and applies a comprehensive block-list of XSS execution vectors. A partial
 * read is not sufficient because payloads can appear anywhere in the document.
 *
 * Deletes the object and returns 400 on any validation failure.
 */
router.post("/verify", authenticate, async (req, res) => {
  const { key } = z.object({ key: z.string() }).parse(req.body);

  const bucket = key.startsWith("logos/") || key.startsWith("products/") || key.startsWith("avatars/")
    ? BUCKETS.BRAND_ASSETS
    : BUCKETS.SHARE_CARDS;

  // Step 1: confirm object exists and get its declared ContentType
  let declaredMime: string;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    declaredMime = head.ContentType ?? "";
  } catch {
    throw createError("File not found in storage", 404);
  }

  // Only validate MIME for the four explicitly allowed types
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(declaredMime)) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    throw createError("Declared content type is not allowed", 400);
  }

  async function deleteAndReject(message: string): Promise<never> {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    throw createError(message, 400);
  }

  // Step 2: fetch file content for inspection
  //   - Binary formats: first 16 bytes is sufficient for magic number detection
  //   - SVG: full file required for complete XSS scanning
  const isSvg = declaredMime === "image/svg+xml";
  const rangeHeader = isSvg ? undefined : "bytes=0-15";

  let buf: Buffer;
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: rangeHeader })
    );
    const bytes = await (obj.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    buf = Buffer.from(bytes);
  } catch {
    throw createError("Failed to read file from storage", 500);
  }

  // Step 3: validate detected MIME against declared MIME
  const detected = detectMime(buf);
  if (detected !== declaredMime) {
    return deleteAndReject("File content does not match declared content type");
  }

  // Step 4: comprehensive SVG XSS scan across the full file content
  if (isSvg && !isSvgSafe(buf.toString("utf8"))) {
    return deleteAndReject("SVG contains disallowed content");
  }

  // Remove ownership record now that the upload is committed
  await redis.del(pendingUploadKey(req.user!.sub, key));
  res.json({ exists: true, publicUrl: getPublicUrl(bucket, key) });
});

/**
 * DELETE /upload/abort
 * Remove an orphan S3 object when /upload/verify could not be confirmed.
 * Called by the client after exhausting verify retries so the file does not
 * sit in storage indefinitely.
 */
router.delete("/abort", authenticate, async (req, res) => {
  const { key } = z.object({ key: z.string().min(1) }).parse(req.body);

  // IDOR guard: only the user who created the presign may abort it
  const ownershipKey = pendingUploadKey(req.user!.sub, key);
  const owned = await redis.get(ownershipKey);
  if (!owned) {
    throw createError("Not authorised to abort this upload", 403);
  }

  const bucket =
    key.startsWith("logos/") ||
    key.startsWith("products/") ||
    key.startsWith("avatars/")
      ? BUCKETS.BRAND_ASSETS
      : BUCKETS.SHARE_CARDS;

  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  await redis.del(ownershipKey);
  res.status(204).end();
});

export default router;
