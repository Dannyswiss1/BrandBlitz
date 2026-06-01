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
