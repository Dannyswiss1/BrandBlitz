import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  getActiveChallenges,
  getChallengeByIdAny,
  getChallengesByBrandId,
  getChallengeQuestions,
} from "../db/queries/challenges";
import { getBrandById } from "../db/queries/brands";
import { getLeaderboard, getArchivedLeaderboard } from "../db/queries/sessions";
import { optionalAuth, authenticate } from "../middleware/authenticate";
import { createError } from "../middleware/error";
import { withCoalescing } from "../lib/cache";
import { config } from "../lib/config";
import { redis } from "../lib/redis";
import { query } from "../db/index";

const router = Router();
const CHALLENGE_DETAIL_CACHE_TTL_SECONDS = 60;

type ChallengeDetailPayload = {
  challenge: Awaited<ReturnType<typeof getChallengeByIdAny>> extends infer T
    ? Exclude<T, null>
    : never;
  questions: Array<Record<string, unknown>>;
};

function challengeDetailCacheKey(id: string): string {
  return `challenge:detail:${id}`;
}

function createEtag(payload: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `"${hash}"`;
}

function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const tag = candidate.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  brandId: z.string().uuid().optional(),
});

/**
 * Get required deposit confirmations from app_config.
 */
async function getRequiredConfirmations(): Promise<number> {
  const result = await query<{ value: { confirmations: number } }>(
    "SELECT value FROM app_config WHERE key = 'deposit_required_confirmations'"
  );
  return result.rows[0]?.value?.confirmations ?? 5;
}

/**
 * GET /challenges
 * List active challenges (public).
 */
router.get("/", optionalAuth, async (req, res) => {
  const parsed = PaginationSchema.safeParse(req.query);
  if (!parsed.success) {
    throw createError("Invalid query parameters", 400, "INVALID_QUERY");
  }

  const { brandId, limit, offset } = parsed.data;

  if (brandId) {
    const brand = await getBrandById(brandId);
    if (!brand || brand.owner_user_id !== req.user?.sub) {
      throw createError("Forbidden", 403);
    }

    const challenges = await getChallengesByBrandId(brandId, limit, offset);
    res.json({ challenges });
    return;
  }

  const challenges = await withCoalescing(
    `challenges:active:${limit}:${offset}`,
    60,
    () => getActiveChallenges(limit, offset)
  );
  res.json({ challenges });
});

/**
 * GET /challenges/:id
 * Get challenge details. Questions (without correct answers) included.
 * For pending_deposit challenges, includes confirmation count and requirement.
 */
router.get("/:id", optionalAuth, async (req, res) => {
  const cacheKey = challengeDetailCacheKey(req.params.id);
  const cachedDetail = await redis.get(cacheKey);
  let payload: ChallengeDetailPayload;

  if (cachedDetail !== null) {
    payload = JSON.parse(cachedDetail) as ChallengeDetailPayload;
  } else {
    const challenge = await getChallengeByIdAny(req.params.id);
    if (!challenge) throw createError("Challenge not found", 404);

    // Return questions without correct_answer and correct_option fields
    const questions = await getChallengeQuestions(challenge.id);
    const safeQuestions = questions.map(({ correct_answer, correct_option, ...q }) => q);
    payload = { challenge, questions: safeQuestions };
    await redis.set(cacheKey, JSON.stringify(payload), "EX", CHALLENGE_DETAIL_CACHE_TTL_SECONDS);
  }

  const etag = createEtag(payload);
  res.set({ ETag: etag, "Cache-Control": "no-cache" });
  if (etagMatches(req.get("If-None-Match"), etag)) {
    res.status(304).end();
    return;
  }

  res.json(payload);
  // For pending_deposit challenges, include confirmation info
  let confirmationInfo = null;
  if (challenge.status === "pending_deposit") {
    const requiredConfirmations = await getRequiredConfirmations();
    confirmationInfo = {
      depositConfirmations: challenge.deposit_confirmations,
      requiredConfirmations,
    };
  }

  res.json({
    challenge: {
      ...challenge,
      ...(confirmationInfo && confirmationInfo),
    },
    questions: safeQuestions,
  });
});

/**
 * GET /challenges/:id/leaderboard
 * Paginated leaderboard for a challenge.
 */
router.get("/:id/leaderboard", async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  const { limit, offset } = PaginationSchema.parse(req.query);
  const sessions = challenge.archived
    ? await getArchivedLeaderboard(challenge.id, limit, offset)
    : await getLeaderboard(challenge.id, limit, offset);

  res.json({
    challengeId: challenge.id,
    sessions: sessions.map((s, i) => ({
      rank: offset + i + 1,
      userId: s.user_id,
      username: s.username,
      displayName: s.display_name,
      league: s.league,
      avatarUrl: s.avatar_url,
      totalScore: s.total_score,
      totalEarned: s.total_earned_usdc,
      endedAt: s.completed_at,
    })),
  });
});

/**
 * GET /challenges/:id/deposit-info
 * Get deposit instructions for a challenge (memo, address, amount).
 * Only accessible to the brand owner.
 * Returns 404 if requester is not the brand owner.
 */
router.get("/:id/deposit-info", authenticate, async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  // Verify requester is the brand owner
  const brand = await getBrandById(challenge.brand_id);
  if (!brand || brand.owner_user_id !== req.user?.sub) {
    throw createError("Forbidden", 403);
  }

  // Only return deposit info if challenge is pending deposit
  if (challenge.status !== "pending_deposit") {
    throw createError("Challenge is not pending deposit", 400);
  }

  res.json({
    depositInfo: {
      hotWalletAddress: config.HOT_WALLET_PUBLIC_KEY,
      memo: challenge.id,
      amount: challenge.pool_amount_usdc,
    },
  });
});

export default router;
