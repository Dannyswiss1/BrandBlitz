import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "auto",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY!,
    secretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_KEY!,
  },
  // true for MinIO (dev), false for Cloudflare R2 or AWS S3 (prod)
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

export const BUCKETS = {
  BRAND_ASSETS: process.env.S3_BUCKET_BRAND_ASSETS ?? "brand-assets",
  SHARE_CARDS: process.env.S3_BUCKET_SHARE_CARDS ?? "share-cards",
} as const;

export type BucketKey = (typeof BUCKETS)[keyof typeof BUCKETS];

/**
 * Returns the publicly accessible URL for a stored object.
 * In dev: http://localhost:9000/brand-assets/logos/uuid.webp
 * In prod: https://assets.brandblitz.app/logos/uuid.webp
 */
export function getPublicUrl(bucket: string, key: string): string {
  const base = process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT || "";
  return `${base}/${bucket}/${key}`;
}

export interface UploadObjectOptions {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
  /**
   * Set to true for content-addressed objects (hashed key).
   * Enables `Cache-Control: public, max-age=31536000, immutable`.
   * Defaults to false for mutable objects (e.g. pre-optimisation originals).
   */
  immutable?: boolean;
}

/**
 * Upload a buffer to S3-compatible storage.
 * When `immutable` is true the object is stored with a one-year immutable
 * cache header — safe whenever the key contains a content hash.
 */
export async function uploadObject({
  bucket,
  key,
  body,
  contentType,
  immutable = false,
}: UploadObjectOptions): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...(immutable
        ? { CacheControl: "public, max-age=31536000, immutable" }
        : {}),
    }),
  );
}
