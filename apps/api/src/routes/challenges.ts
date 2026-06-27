import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  getActiveChallenges,
  getActiveChallengesCursor,
  getFilteredChallenges,
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
import { reportLimiter } from "../middleware/rate-limit";
import { withCoalescing } from "../lib/cache";
import { redis } from "../lib/redis";
import { config } from "../lib/config";
import { CursorQuerySchema } from "../db/pagination";
import { query, pool } from "../db/index";

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

const ChallengeFilterSchema = CursorQuerySchema.extend({
  brandId: z.string().uuid().optional(),
  status: z.enum(["active", "upcoming", "ended"]).optional(),
  min_pool: z.coerce.number().min(0).optional(),
  end_before: z.string().datetime({ offset: true }).optional(),
});

/**
 * GET /challenges
 * List challenges (public). Supports keyset cursor pagination via ?cursor.
 * Optional filters: ?status=, ?min_pool= (USDC), ?end_before= (ISO datetime).
 * Legacy ?offset parameter is accepted but ignored; clients should migrate to ?cursor.
 */
router.get("/", optionalAuth, async (req, res) => {
  const parsed = ChallengeFilterSchema.safeParse(req.query);
  if (!parsed.success) {
    throw createError("Invalid query parameters", 400, "INVALID_QUERY");
  }

  const { brandId, limit, cursor, status, min_pool, end_before } = parsed.data;

  if (brandId) {
    const { challenges, nextCursor } = await getChallengesByBrandId(brandId, limit, cursor);
    res.json({ data: challenges, nextCursor });
    return;
  }

  const hasFilters = status !== undefined || min_pool !== undefined || end_before !== undefined;

  if (!hasFilters) {
    const cacheKey = `challenges:active:global:${cursor ?? "start"}:${limit}`;
    const cacheHit = await redis.get(cacheKey);
    const result = await withCoalescing(
      cacheKey,
      CHALLENGES_CACHE_TTL_SEC,
      () => getActiveChallengesCursor(cursor, limit)
    );
    res.setHeader("X-Cache", cacheHit !== null ? "HIT" : "MISS");
    res.json({ data: result.challenges, nextCursor: result.nextCursor });
    return;
  }

  const { challenges, nextCursor } = await getFilteredChallenges({
    status,
    minPoolUsdc: min_pool,
    endBefore: end_before,
    cursor,
    limit,
  });
  res.json({ data: challenges, nextCursor });
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

/**
 * POST /challenges/:id/report
 * Report inappropriate challenge content. Requires authentication.
 * Rate-limited per user; one report per user per challenge enforced via challenge_reports.
 * Atomically increments reported_count within a transaction.
 */
router.post("/:id/report", authenticate, reportLimiter, async (req, res) => {
  const challenge = await getChallengeByIdAny(req.params.id);
  if (!challenge) throw createError("Challenge not found", 404);

  const ReportSchema = z.object({
    reason: z.enum([
      "misleading_content",
      "inappropriate_language",
      "factually_incorrect",
      "other",
    ]),
    note: z.string().max(500).optional(),
  });

  const body = ReportSchema.parse(req.body);
  const userId = req.user!.sub;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id FROM challenge_reports WHERE challenge_id = $1 AND user_id = $2`,
      [challenge.id, userId]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      throw createError("You have already reported this challenge", 409, "ALREADY_REPORTED");
    }

    await client.query(
      `INSERT INTO challenge_reports (challenge_id, user_id, reason, note)
       VALUES ($1, $2, $3, $4)`,
      [challenge.id, userId, body.reason, body.note ?? null]
    );

    await client.query(
      `UPDATE challenges SET reported_count = reported_count + 1 WHERE id = $1`,
      [challenge.id]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  res.status(201).json({ success: true });
});

export default router;
