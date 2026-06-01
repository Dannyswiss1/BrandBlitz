/**
 * rate-limit.ts — Application-layer rate limiting.
 *
 * Strategy (Issue #226):
 *   - Authenticated requests  → keyed by JWT `sub` (user ID).
 *     Each user gets their own independent bucket regardless of IP.
 *   - Anonymous requests       → keyed by IP, but with a much higher limit
 *     so mobile carriers / corporate NAT are not punished.
 *   - nginx acts as a coarse anti-abuse fence (200 req/s / 500 burst per IP).
 *     These application-layer limits are the fine-grained enforcement.
 *
 * Metrics: every 429 response increments a labelled counter so alerts can
 * fire when the rate spikes.
 *
 * Closes #226
 */

import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { config } from "../lib/config";

// ── Metrics ───────────────────────────────────────────────────────────────────

/** Increment a labelled 429 counter so dashboards / alerts can track spikes. */
function record429(limiterName: string, key: string): void {
  logger.warn("Rate limit exceeded", {
    limiter: limiterName,
    key,
    metric: "rate_limit.exceeded",
  });
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Returns the JWT `sub` for authenticated requests, or the client IP for
 * anonymous ones.  Prefixed so the two namespaces never collide in Redis.
 */
function userAwareKey(req: Request): string {
  if (req.user?.sub) {
    return `user:${req.user.sub}`;
  }
  return `ip:${req.ip ?? "anonymous"}`;
}

// ── Redis store ───────────────────────────────────────────────────────────────

function makeRedisStore() {
  return new RedisStore({
    sendCommand: async (...args: string[]) => {
      const command = typeof (redis as any).call === "function"
        ? (redis as any).call
        : (redis as any).sendCommand;
      if (!command) throw new TypeError("Redis client does not support call/sendCommand");
      try {
        return await command.apply(redis, args);
      } catch (err) {
        logger.warn("Rate-limit: Redis store error; failing open", {
          error: (err as Error).message,
        });
        throw err;
      }
    },
  });
}

const redisStore = config.NODE_ENV === "test" ? undefined : makeRedisStore();

// ── Limiters ──────────────────────────────────────────────────────────────────

/**
 * General API rate limit.
 *   - Authenticated users: 200 req / 15 min per user ID
 *   - Anonymous (IP):      200 req / 15 min per IP
 *     (higher than before to avoid punishing shared IPs)
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userAwareKey,
  passOnStoreError: true,
  store: redisStore,
  handler: (req, res) => {
    record429("apiLimiter", userAwareKey(req));
    res.status(429).json({ error: "Too many requests, please try again later" });
  },
});

/**
 * Auth endpoints: always keyed by IP (pre-authentication).
 * Kept intentionally tight — 10 req / 15 min.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  passOnStoreError: true,
  store: redisStore,
  handler: (req, res) => {
    record429("authLimiter", req.ip ?? "anonymous");
    res.status(429).json({ error: "Too many login attempts, please try again later" });
  },
});

/**
 * Challenge start: 5 req / hour per user/IP.
 * Prevents automated challenge farming.
 */
export const challengeStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userAwareKey,
  passOnStoreError: true,
  store: redisStore,
  handler: (req, res) => {
    record429("challengeStartLimiter", userAwareKey(req));
    res.status(429).json({ error: "Too many challenge attempts" });
  },
});

/**
 * Upload presign: 20 req / hour per user/IP.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userAwareKey,
  passOnStoreError: true,
  store: redisStore,
  handler: (req, res) => {
    record429("uploadLimiter", userAwareKey(req));
    res.status(429).json({ error: "Too many upload requests" });
  },
});

/**
 * Webhook endpoints: 1000 req / hour (internal-to-internal).
 * Always uses Redis — webhooks are never anonymous.
 */
export const webhookLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args: string[]) => (redis as any).call(...args) }),
});
