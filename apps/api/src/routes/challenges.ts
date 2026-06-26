import { Router } from "express";
import { z } from "zod";
import {
  getActiveChallenges,
  getActiveChallengesCursor,
  getChallengeByIdAny,
  getChallengesByBrandId,
  getChallengeQuestions,
} from "../db/queries/challenges";
import { getBrandById } from "../db/queries/brands";
import {
  getLeaderboard,
  getArchivedLeaderboard,
  LEADERBOARD_SORTS,
  type LeaderboardSort,
} from "../db/queries/sessions";
import { optionalAuth, authenticate } from "../middleware/authenticate";
import { createError } from "../middleware/error";
import { withCoalescing } from "../lib/cache";
import { redis } from "../lib/redis";
import { config } from "../lib/config";
import { CursorQuerySchema } from "../db/pagination";
import { query } from "../db/index";

const router = Router();

const CHALLENGES_CACHE_TTL_SEC = 10;

const LeaderboardSortSchema = z.enum(LEADERBOARD_SORTS).default("score");

function parseLeaderboardSort(query: Record<string, unknown>): LeaderboardSort {
  const parsed = LeaderboardSortSchema.safeParse(query.sort_by ?? query.order);
  if (!parsed.success) {
    throw createError(
      `Invalid leaderboard sort. Allowed values: ${LEADERBOARD_SORTS.join(", ")}`,
      400,
      "INVALID_SORT",
    );
  }
  return parsed.data;
}
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
 * List active challenges (public). Supports keyset cursor pagination via ?cursor.
 * Legacy ?offset parameter is accepted but ignored; clients should migrate to ?cursor.
 */
router.get("/", optionalAuth, async (req, res) => {
  const parsed = CursorQuerySchema.extend({
    brandId: z.string().uuid().optional(),
  }).safeParse(req.query);
  if (!parsed.success) {
    throw createError("Invalid query parameters", 400, "INVALID_QUERY");
  }

  const { brandId, limit, cursor } = parsed.data;

  if (brandId) {
    const { challenges, nextCursor } = await getChallengesByBrandId(brandId, limit, cursor);
    res.json({ data: challenges, nextCursor });
    return;
  }

  const cacheKey = `challenges:active:global:${cursor ?? 'start'}:${limit}`;

  const cacheHit = await redis.get(cacheKey);
  const result = await withCoalescing(
    cacheKey,
    CHALLENGES_CACHE_TTL_SEC,
    () => getActiveChallengesCursor(cursor, limit)
  );

  res.setHeader("X-Cache", cacheHit !== null ? "HIT" : "MISS");
  res.json({ data: result.challenges, nextCursor: result.nextCursor });
});

/**
 * GET /challenges/:id
 * Get challenge details. Questions (without correct answers) included.
 * For pending_deposit challenges, includes confirmation count and requirement.
 */
router.get("/:id", optionalAuth, async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  // Return questions without correct_answer and correct_option fields
  const questions = await getChallengeQuestions(challenge.id);
  const safeQuestions = questions.map(({ correct_answer, correct_option, ...q }) => q);

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
 * Paginated leaderboard for a challenge. Supports keyset cursor pagination.
 */
router.get("/:id/leaderboard", async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  const sortBy = parseLeaderboardSort(req.query);
  const { limit, cursor } = CursorQuerySchema.parse(req.query);
  const result = challenge.archived
    ? await getArchivedLeaderboard(challenge.id, limit, cursor)
    : await getLeaderboard(challenge.id, limit, cursor, sortBy);

  res.json({
    challengeId: challenge.id,
    nextCursor: result.nextCursor,
    sessions: result.sessions.map((s, i) => ({
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
