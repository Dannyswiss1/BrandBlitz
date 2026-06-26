import { Router } from "express";
import { redis } from "../lib/redis";
import { authenticate } from "../middleware/authenticate";
import { requireAdmin } from "../middleware/require-admin";

const router = Router();

const BADGES_CACHE_TTL_SEC = 86400;
const BADGES_CACHE_KEY = "badges:definitions";

interface BadgeDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  iconUrl?: string;
}

async function fetchBadgeDefinitionsFromDb(): Promise<BadgeDefinition[]> {
  const { query } = await import("../db/index");
  const result = await query<BadgeDefinition>(
    `SELECT id, slug, name, description, icon_url AS "iconUrl" FROM badge_definitions ORDER BY name ASC`
  );
  return result.rows;
}

/**
 * GET /api/badges
 * Returns badge definitions. Cached in Redis for 24h.
 */
router.get("/", async (_req, res) => {
  const cached = await redis.get(BADGES_CACHE_KEY);
  if (cached !== null) {
    res.setHeader("X-Cache", "HIT");
    res.json({ badges: JSON.parse(cached) });
    return;
  }

  const badges = await fetchBadgeDefinitionsFromDb();
  await redis.set(BADGES_CACHE_KEY, JSON.stringify(badges), "EX", BADGES_CACHE_TTL_SEC);
  res.setHeader("X-Cache", "MISS");
  res.json({ badges });
});

/**
 * POST /api/admin/cache/badges/flush
 * Admin-only: flush the badges definitions cache.
 */
router.post("/flush", authenticate, requireAdmin, async (_req, res) => {
  await redis.del(BADGES_CACHE_KEY);
  res.status(204).send();
});

export default router;
