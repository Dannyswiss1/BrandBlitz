import { Router } from "express";
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
import { CursorQuerySchema } from "../db/pagination";

const router = Router();

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
    const brand = await getBrandById(brandId);
    if (!brand || brand.owner_user_id !== req.user?.sub) {
      throw createError("Forbidden", 403);
    }

    const { challenges, nextCursor } = await getChallengesByBrandId(brandId, limit, cursor);
    res.json({ challenges, nextCursor });
    return;
  }

  const { challenges, nextCursor } = await withCoalescing(
    `challenges:active:${limit}:${cursor ?? "first"}`,
    60,
    () => getActiveChallenges(limit, cursor)
  );
  res.json({ challenges, nextCursor });
});

/**
 * GET /challenges/:id
 * Get challenge details. Questions (without correct answers) included.
 */
router.get("/:id", optionalAuth, async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  // Return questions without correct_answer and correct_option fields
  const questions = await getChallengeQuestions(challenge.id);
  const safeQuestions = questions.map(({ correct_answer, correct_option, ...q }) => q);

  res.json({ challenge, questions: safeQuestions });
});

/**
 * GET /challenges/:id/leaderboard
 * Paginated leaderboard for a challenge. Supports keyset cursor pagination.
 */
router.get("/:id/leaderboard", async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  const { limit, cursor } = CursorQuerySchema.parse(req.query);
  const result = challenge.archived
    ? await getArchivedLeaderboard(challenge.id, limit, cursor)
    : await getLeaderboard(challenge.id, limit, cursor);

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
