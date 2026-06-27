import type { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { createFraudFlag } from "../db/queries/fraud-flags";
import { getConfig } from "../db/queries/config";
import { getSession, claimSession } from "../db/queries/sessions";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";
import { computeFingerprint } from "../lib/fingerprint";
import { createError } from "./error";
import { normalizeClientIp } from "./rate-limit";
import { MAX_ROUND_SCORE, MAX_TOTAL_SCORE } from "../services/scoring";

export const BOT_REACTION_THRESHOLD_MS = 80;
// Fallback defaults — override at runtime via PATCH /admin/config/anti_cheat.thresholds
export const MIN_HUMAN_REACTION_MS = 150;
export const MAX_HUMAN_REACTION_MS = 30_000;

const THRESHOLDS_CACHE_KEY = "config:cache:anti_cheat.thresholds";
const THRESHOLDS_CONFIG_KEY = "anti_cheat.thresholds";
const CACHE_TTL_SECONDS = 5;

interface AntiCheatThresholds {
  min_human_reaction_ms: number;
  max_human_reaction_ms: number;
}

async function getThresholds(): Promise<AntiCheatThresholds> {
  try {
    const cached = await redis.get(THRESHOLDS_CACHE_KEY);
    if (cached) return JSON.parse(cached) as AntiCheatThresholds;

    const config = await getConfig(THRESHOLDS_CONFIG_KEY);
    const thresholds: AntiCheatThresholds = {
      min_human_reaction_ms:
        (config?.min_human_reaction_ms as number) ?? MIN_HUMAN_REACTION_MS,
      max_human_reaction_ms:
        (config?.max_human_reaction_ms as number) ?? MAX_HUMAN_REACTION_MS,
    };

    await redis.set(THRESHOLDS_CACHE_KEY, JSON.stringify(thresholds), "EX", CACHE_TTL_SECONDS);
    return thresholds;
  } catch {
    return {
      min_human_reaction_ms: MIN_HUMAN_REACTION_MS,
      max_human_reaction_ms: MAX_HUMAN_REACTION_MS,
    };
  }
}

async function resolveSessionId(req: Request): Promise<string | undefined> {
  const existingSessionId = (req as any).sessionId as string | undefined;
  if (existingSessionId) return existingSessionId;

  const challengeId = req.params.challengeId;
  const userId = req.user?.sub;
  if (!challengeId || !userId) return undefined;

  const session = await getSession(userId, challengeId);
  return session?.id;
}

async function recordFraudFlag(
  req: Request,
  flagType: string,
  details?: Record<string, unknown>
): Promise<void> {
  const userId = req.user?.sub;
  if (!userId) return;

  const sessionId = await resolveSessionId(req);
  if (!sessionId) return;

  await createFraudFlag({ sessionId, userId, flagType, details });
  // Fraud review queries rely on idx_game_sessions_flagged for flagged-session scans.

  const severity = (details?.severity as string) || "warning";
  metrics.inc("antiCheat.flags_total", { severity, type: flagType });
}

/**
 * Anti-cheat Layer 3 — server-side timing validation.
 * Validates that answer submission timing falls within human range.
 * Thresholds are read from app_config (5s Redis cache) with fallback to defaults.
 */
export async function validateReactionTime(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { reactionTimeMs } = req.body as { reactionTimeMs?: number };

  if (reactionTimeMs === undefined) {
    next();
    return;
  }

  if (reactionTimeMs < BOT_REACTION_THRESHOLD_MS) {
    await recordFraudFlag(req, "reaction_time_bot_threshold", {
      reactionTimeMs,
      severity: "critical",
    }).catch(() => {});
    throw createError("Reaction time impossible for humans", 403, "REACTION_IMPOSSIBLE");
  }

  const thresholds = await getThresholds();

  if (reactionTimeMs < thresholds.min_human_reaction_ms) {
    await recordFraudFlag(req, "reaction_time_below_minimum", {
      reactionTimeMs,
      severity: "warning",
    }).catch(() => {});
  }

  if (reactionTimeMs > thresholds.max_human_reaction_ms) {
    await recordFraudFlag(req, "reaction_time_above_maximum", {
      reactionTimeMs,
      severity: "info",
    }).catch(() => {});
  }

  next();
}

/**
 * Enforces: 1 competitive session per account per challenge.
 * Uses the DB UNIQUE constraint atomically — no check-then-act race.
 */
export async function enforceOneSessionPerChallenge(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.user!.sub;
  const { challengeId } = req.params;

  const session = await claimSession({
    userId,
    challengeId,
    deviceId:
      (req.headers["x-device-id"] as string | undefined) ??
      (req.headers["x-visitor-id"] as string | undefined),
    isPractice: req.body.isPractice === true,
  });

  if (session) {
    (req as any).session = session;
    next();
    return;
  }

  // Session already exists — fetch and return existing one idempotently
  const existing = await getSession(userId, challengeId);
  if (!existing) {
    throw createError("Session not found", 404);
  }
  (req as any).session = existing;
  next();
}

/**
 * Anti-cheat Layer 2 — stable device fingerprint check.
 * Derives a server-side fingerprint from (visitorId | deviceId) + IP /24 + UA hash.
 * Rejects sessions when the fingerprint is shared by >2 accounts in 24 h.
 */
export async function validateDeviceFingerprint(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const rawVisitorId = req.headers["x-visitor-id"];
  const rawDeviceId = req.headers["x-device-id"];

  const visitorId = Array.isArray(rawVisitorId) ? rawVisitorId[0] : rawVisitorId;
  const deviceId = Array.isArray(rawDeviceId) ? rawDeviceId[0] : rawDeviceId;

  if (!visitorId && !deviceId) {
    throw createError("Missing X-Device-Id header", 400, "MISSING_DEVICE_ID");
  }

  const userId = req.user?.sub;
  if (!userId) {
    next();
    return;
  }

  try {
    const fingerprint = computeFingerprint({
      visitorId,
      deviceId,
      ip: normalizeClientIp(req.ip),
      userAgent: req.headers["user-agent"],
    });

    const fpKey = `fp:${fingerprint}:accounts`;
    await redis.sadd(fpKey, userId);
    await redis.expire(fpKey, 86400); // 24 h window
    const count = await redis.scard(fpKey);

    if (count >= 3) {
      metrics.inc("antiCheat.fingerprint_collision_total", {
        fingerprint: fingerprint.slice(0, 8),
      });
      await recordFraudFlag(req, "multi_account_fingerprint", {
        fingerprint: fingerprint.slice(0, 8),
        accountCount: count,
        windowSeconds: 86400,
        severity: "critical",
      }).catch(() => {});
      throw createError(
        "Session rejected due to fingerprint collision",
        403,
        "FINGERPRINT_COLLISION"
      );
    }
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) {
      throw error;
    }
    logger.warn("Redis unavailable during device fingerprint validation; failing open", {
      userId,
      error: (error as Error).message,
    });
  }

  next();
}

/**
 * Anti-cheat Layer 4 — score bounds validation.
 * Flags sessions where a round score exceeds the per-round maximum.
 * Called after server-side score computation, before persisting.
 */
export async function validateRoundScore(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const { roundScore } = req.body as { roundScore?: number };

  if (roundScore === undefined) {
    next();
    return;
  }

  if (!Number.isFinite(roundScore) || roundScore < 0 || roundScore > MAX_ROUND_SCORE) {
    await recordFraudFlag(req, "round_score_out_of_range", {
      roundScore,
      maxAllowed: MAX_ROUND_SCORE,
      severity: "critical",
    }).catch(() => {});
    throw createError(
      `Round score ${roundScore} exceeds per-round maximum of ${MAX_ROUND_SCORE}`,
      422,
      "ROUND_SCORE_OUT_OF_RANGE"
    );
  }

  next();
}

/**
 * Validate that a total session score is within bounds.
 * Returns a structured error if the value would exceed [0, MAX_TOTAL_SCORE].
 * Intended for use after score computation and before persistence.
 */
export function assertValidTotalScore(totalScore: number): void {
  if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > MAX_TOTAL_SCORE) {
    throw createError(
      `Total score ${totalScore} is outside valid range [0, ${MAX_TOTAL_SCORE}]`,
      422,
      "TOTAL_SCORE_OUT_OF_RANGE"
    );
  }
}
