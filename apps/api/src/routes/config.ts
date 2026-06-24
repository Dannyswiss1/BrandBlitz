import { Router } from "express";
import { getPublicConfig, type PublicConfig } from "../db/queries/config";
import { redis } from "../lib/redis";

export const PUBLIC_CONFIG_CACHE_KEY = "config:public";
export const PUBLIC_CONFIG_CACHE_TTL_SECONDS = 60;

const router = Router();

/**
 * GET /config
 *
 * Public, read-through runtime configuration. The exact JSON envelope is
 * constructed before it reaches Redis so cached and uncached responses are
 * byte-for-byte the same shape.
 */
router.get("/", async (_req, res) => {
  const cached = await redis.get(PUBLIC_CONFIG_CACHE_KEY);
  if (cached !== null) {
    res.set("X-Cache", "HIT");
    res.json(JSON.parse(cached));
    return;
  }

  const config = await getPublicConfig();
  const payload: { config: PublicConfig } = { config };
  await redis.set(
    PUBLIC_CONFIG_CACHE_KEY,
    JSON.stringify(payload),
    "EX",
    PUBLIC_CONFIG_CACHE_TTL_SECONDS,
  );

  res.set("X-Cache", "MISS");
  res.json(payload);
});

export default router;
