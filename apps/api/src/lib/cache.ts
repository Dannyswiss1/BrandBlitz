import { redis } from "./redis";
import { metrics } from "./metrics";

const LOCK_TTL_SEC = 10;
const WAIT_TOTAL_MS = 500;
const POLL_INTERVAL_MS = 50;

/**
 * Generic Redis cache wrapper with stampede protection.
 *
 * On a miss the first caller acquires a short NX lock, runs the loader,
 * writes the result, and releases the lock.  Concurrent callers poll for up
 * to WAIT_TOTAL_MS before falling through to the loader themselves.
 */
export async function cached<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = await redis.get(key);
  if (hit !== null) {
    metrics.inc("cache.hit_total", { key });
    return JSON.parse(hit) as T;
  }

  metrics.inc("cache.miss_total", { key });

  const lockKey = `lock:${key}`;
  const acquired = await redis.set(lockKey, "1", "EX", LOCK_TTL_SEC, "NX");

  if (acquired === "OK") {
    try {
      const value = await loader();
      await redis.set(key, JSON.stringify(value), "EX", ttlSec);
      return value;
    } finally {
      await redis.del(lockKey);
    }
  }

  // Another caller holds the lock — wait for the cache to be populated
  const deadline = Date.now() + WAIT_TOTAL_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const waited = await redis.get(key);
    if (waited !== null) {
      metrics.inc("cache.stampede_avoided_total", { key });
      return JSON.parse(waited) as T;
    }
  }

  // Timeout — fall through to loader without re-acquiring the lock
  const value = await loader();
  await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  return value;
}

/**
 * Request coalescing cache wrapper to prevent thundering herd on cold start.
 *
 * Uses a Redis lock (SETNX) to ensure only one request regenerates the cache
 * value when a key expires. Other concurrent requests wait briefly and reuse
 * the result. If the lock holder crashes, the lock expires after lockTtlSec
 * and subsequent requests regenerate the value.
 *
 * @param key - Redis cache key
 * @param ttlSec - Cache TTL in seconds
 * @param loader - Async function that regenerates the cache value
 * @param lockTtlSec - Lock expiry in seconds (default: 5)
 * @returns Cached or freshly loaded value
 */
export async function withCoalescing<T>(
  key: string,
  ttlSec: number,
  loader: () => Promise<T>,
  lockTtlSec: number = 5,
): Promise<T> {
  // Check cache first
  const hit = await redis.get(key);
  if (hit !== null) {
    metrics.inc("cache.hit_total", { key });
    return JSON.parse(hit) as T;
  }

  metrics.inc("cache.miss_total", { key });

  const lockKey = `coalesce:${key}`;

  // Try to acquire the lock
  const acquired = await redis.set(lockKey, "1", "EX", lockTtlSec, "NX");

  if (acquired === "OK") {
    // This request won the race — regenerate the value
    try {
      const value = await loader();
      await redis.set(key, JSON.stringify(value), "EX", ttlSec);
      return value;
    } finally {
      // Release the lock
      await redis.del(lockKey);
    }
  }

  // Another request holds the lock — wait for it to populate the cache
  const waitStart = Date.now();
  const waitDeadline = waitStart + (lockTtlSec * 1000);

  while (Date.now() < waitDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const cached = await redis.get(key);
    if (cached !== null) {
      metrics.inc("cache.coalesced_total", { key });
      return JSON.parse(cached) as T;
    }

    // Check if lock expired (holder crashed)
    const lockExists = await redis.exists(lockKey);
    if (lockExists === 0) {
      // Lock expired — try to acquire and regenerate
      const retryAcquired = await redis.set(lockKey, "1", "EX", lockTtlSec, "NX");
      if (retryAcquired === "OK") {
        try {
          const value = await loader();
          await redis.set(key, JSON.stringify(value), "EX", ttlSec);
          return value;
        } finally {
          await redis.del(lockKey);
        }
      }
    }
  }

  // Timeout — fall through and regenerate without lock
  metrics.inc("cache.coalesce_timeout_total", { key });
  const value = await loader();
  await redis.set(key, JSON.stringify(value), "EX", ttlSec);
  return value;
}
