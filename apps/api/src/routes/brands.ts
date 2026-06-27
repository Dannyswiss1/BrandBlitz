import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  createBrand,
  getBrandsByOwner,
  getBrandById,
  getPublicBrandById,
  getPublicBrands,
  getBrandMetaById,
  getActiveDistractorBrands,
  toBrandApi,
  toPublicBrandApi,
  updateBrand,
  deleteBrand,
  getBrandChallengeStats,
} from "../db/queries/brands";
import { getBrandAnalytics } from "../db/queries/analytics";
import {
  createChallenge,
  insertChallengeQuestions,
  getChallengeQuestions,
  getChallengesByBrandId,
  deleteChallengeQuestion,
  insertChallengeQuestion,
} from "../db/queries/challenges";
import { generateChallengeQuestions } from "../services/questions";
import { optimizeImage, StorageError } from "@brandblitz/storage";
import { authenticate } from "../middleware/authenticate";
import { requireCurrentTosAccepted } from "../middleware/require-tos";
import { createError } from "../middleware/error";
import { logger } from "../lib/logger";
import { config } from "../lib/config";
import { MIN_POOL_STROOPS } from "@brandblitz/stellar";
import { query } from "../db/index";
import { sanitizeSvgText } from "../lib/svg-sanitize";

const router = Router();
const PublicBrandsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const BrandKitSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .refine((v) => !/<[^>]*>/.test(v), { message: "Brand name must not contain HTML tags" }),
  logoKey: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  tagline: z.string().max(100).optional(),
  brandStory: z.string().max(500).optional(),
  usp: z.string().max(200).optional(),
  productImage1Key: z.string().optional(),
  productImage2Key: z.string().optional(),
});

const ChallengeSchema = z.object({
  brandId: z.string().uuid(),
  poolAmountUsdc: z
    .string()
    .regex(/^\d+(\.\d{1,7})?$/)
    .refine(
      (val) => {
        // Convert USDC amount to stroops and check minimum
        const stroops = Math.round(parseFloat(val) * 10_000_000);
        return stroops >= MIN_POOL_STROOPS;
      },
      {
        message: `Pool amount must be at least 100 USDC (${MIN_POOL_STROOPS.toLocaleString()} stroops)`,
      }
    ),
  maxPlayers: z.number().int().positive().optional(),
  endsAt: z.string().datetime(),
});

const MIN_CHALLENGE_DURATION_MS = 60 * 60 * 1000;
const CHALLENGE_DURATION_GRACE_MS = 5_000;

function validateChallengeEndsAt(endsAt: string): void {
  const endsAtMs = new Date(endsAt).getTime();
  const nowMs = Date.now();
  const minEndsAtMs = nowMs + MIN_CHALLENGE_DURATION_MS;

  if (endsAtMs <= nowMs) {
    throw createError("Challenge end time must be in the future", 400, "ENDS_AT_PAST");
  }

  if (endsAtMs < minEndsAtMs - CHALLENGE_DURATION_GRACE_MS) {
    throw createError(
      "Challenge duration must be at least 1 hour",
      400,
      "ENDS_AT_TOO_SOON"
    );
  }
}

/**
 * GET /brands/public
 * Public directory of all brands with active challenge counts. No auth required.
 */
router.get("/public", async (req, res) => {
  const result = await query<{
    id: string;
    name: string;
    tagline: string | null;
    logo_url: string | null;
    primary_color: string | null;
    category: string | null;
    active_challenge_count: number;
  }>(
    `SELECT
       b.id,
       b.name,
       b.tagline,
       b.logo_url,
       b.primary_color,
       NULL AS category,
       COUNT(c.id) FILTER (WHERE c.status = 'active')::int AS active_challenge_count
     FROM brands b
     LEFT JOIN challenges c ON c.brand_id = b.id
     WHERE b.deleted_at IS NULL
     GROUP BY b.id
     ORDER BY b.name ASC`
  );

  res.json({ brands: result.rows });
});

/**
 * GET /brands
 * List brands owned by the authenticated user.
 */
router.get("/", authenticate, async (req, res) => {
  const brands = await getBrandsByOwner(req.user!.sub);
  res.json({ brands: brands.map(toBrandApi) });
});

/**
 * GET /brands/:id
 */
router.get("/:id", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);
  res.json({ brand: toBrandApi(brand) });
});

/**
 * GET /brands/:id/analytics
 * Returns aggregated analytics data for the brand's challenges.
 */
router.get("/:id/analytics", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;

  let from: Date | undefined;
  let to: Date | undefined;

  if (fromParam) {
    from = new Date(fromParam);
    if (isNaN(from.getTime())) throw createError("Invalid from date", 400);
  }
  if (toParam) {
    to = new Date(toParam);
    if (isNaN(to.getTime())) throw createError("Invalid to date", 400);
  }

  const analytics = await getBrandAnalytics(brand.id, from, to);
  res.json({ analytics });
});

/**
 * DELETE /brands/:id
 * Soft-delete a brand kit (prevents new activity; existing challenges continue).
 */
router.delete("/:id", authenticate, async (req, res) => {
  const meta = await getBrandMetaById(req.params.id);
  if (!meta || meta.deleted_at) throw createError("Brand not found", 404);
  if (meta.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const deleted = await deleteBrand(req.params.id, req.user!.sub);
  if (!deleted) throw createError("Brand not found", 404);

  res.status(204).send();
});

/**
 * GET /brands/:id/dashboard
 * Get aggregated challenge stats for a brand's dashboard.
 * Uses the brand_challenge_stats view for efficient single-query aggregation.
 */
router.get("/:id/dashboard", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const stats = await getBrandChallengeStats(brand.id);
  res.json({ stats });
});

/**
 * GET /brands/:id/questions/preview
 * Returns questions (with correct answers) for the latest challenge of a brand.
 * Accessible only to the brand owner for previewing before launch.
 */
router.get("/:id/questions/preview", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const { challenges } = await getChallengesByBrandId(brand.id, 1);
  if (challenges.length === 0) {
    res.json({ questions: [], challenge: null });
    return;
  }

  const challenge = challenges[0];
  const questions = await getChallengeQuestions(challenge.id);
  res.json({ questions, challenge });
});

/**
 * POST /brands/:id/questions/:questionId/regenerate
 * Delete a question and regenerate it for the same round.
 * Returns the new question with correct_answer.
 */
router.post("/:id/questions/:questionId/regenerate", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const { questionId } = req.params;
  const allQuestions = await query<{ id: string; challenge_id: string; round: 1 | 2 | 3 }>(
    "SELECT id, challenge_id, round FROM challenge_questions WHERE id = $1",
    [questionId]
  );
  const existing = allQuestions.rows[0];
  if (!existing) throw createError("Question not found", 404);

  const challenge = await getBrandById(brand.id);
  if (!challenge) throw createError("Brand not found", 404);

  const distractorBrands = await getActiveDistractorBrands(brand.id);
  const regenerated = generateChallengeQuestions(existing.challenge_id, brand, distractorBrands);
  const newDraft = regenerated.find((q) => q.round === existing.round) ?? regenerated[0];

  await deleteChallengeQuestion(questionId);
  const inserted = await insertChallengeQuestion({ ...newDraft, challenge_id: existing.challenge_id });

  res.json({ question: inserted });
});

/**
 * POST /brands/:id/questions/:questionId/approve
 * Mark a question as approved.
 */
router.post("/:id/questions/:questionId/approve", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const { questionId } = req.params;
  await query("UPDATE challenge_questions SET approved = true WHERE id = $1", [questionId]);
  res.json({ success: true });
});

/**
 * POST /brands/:id/questions/:questionId/flag
 * Mark a question as flagged for regeneration.
 */
router.post("/:id/questions/:questionId/flag", authenticate, async (req, res) => {
  const brand = await getBrandById(req.params.id);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const { questionId } = req.params;
  await query("UPDATE challenge_questions SET approved = false WHERE id = $1", [questionId]);
  res.json({ success: true });
});

/**
 * POST /brands
 * Create a brand kit. Optimizes uploaded images immediately.
 */
router.post("/", authenticate, async (req, res) => {
  const body = BrandKitSchema.parse(req.body);
  const userId = req.user!.sub;

  let logoUrl: string | undefined;
  const productImageKeys: string[] = [];

  // Optimize uploaded images server-side (converts to WebP, resizes)
  try {
    if (body.logoKey) {
      const optimizedKey = await optimizeImage(body.logoKey, "brand-logo");
      const { getPublicUrl, BUCKETS } = await import("@brandblitz/storage");
      logoUrl = getPublicUrl(BUCKETS.BRAND_ASSETS, optimizedKey);
    }
    if (body.productImage1Key) {
      const optimizedKey = await optimizeImage(body.productImage1Key, "product-image");
      productImageKeys.push(optimizedKey);
    }
    if (body.productImage2Key) {
      const optimizedKey = await optimizeImage(body.productImage2Key, "product-image");
      productImageKeys.push(optimizedKey);
    }
  } catch (error) {
    if (error instanceof StorageError || (error as any).name === "StorageError") {
      console.error(`[api] Image optimization failed for body key. Reason: ${(error as Error).message}`);
      throw createError("Image upload could not be processed. Please try again with a valid image.", 400);
    }
    throw error;
  }

  const brand = await createBrand({
    owner_user_id: userId,
    name: sanitizeSvgText(body.name),
    logo_url: logoUrl ?? null,
    primary_color: body.primaryColor ?? null,
    secondary_color: body.secondaryColor ?? null,
    tagline: body.tagline ? sanitizeSvgText(body.tagline) : null,
    brand_story: body.brandStory ?? null,
    usp: body.usp ?? null,
    product_image_keys: productImageKeys,
  });

  res.status(201).json({ brand: toBrandApi(brand) });
});

/**
 * POST /brands/challenges
 * Create a new challenge and generate questions from brand kit.
 * Returns the Stellar memo (challenge_id) for the deposit instructions.
 */
router.post("/challenges", authenticate, requireCurrentTosAccepted, async (req, res) => {
  const body = ChallengeSchema.parse(req.body);
  validateChallengeEndsAt(body.endsAt);

  const brand = await getBrandById(body.brandId);
  if (!brand) throw createError("Brand not found", 404);
  if (brand.owner_user_id !== req.user!.sub) throw createError("Forbidden", 403);

  const challengeId = randomUUID();
  const challenge = await createChallenge({
    brandId: body.brandId,
    challengeId,
    poolAmountUsdc: body.poolAmountUsdc,
    maxPlayers: body.maxPlayers,
    endsAt: body.endsAt,
  });

  const distractorBrands = await getActiveDistractorBrands(body.brandId);
  if (distractorBrands.length === 0) {
    logger.warn("Distractor pool is empty; using fallback options for generated questions", {
      brandId: body.brandId,
      challengeId: challenge.id,
    });
  }

  // Auto-generate questions from brand kit (uses other brands as distractors if available)
  const questions = generateChallengeQuestions(challenge.id, brand, distractorBrands);
  await insertChallengeQuestions(questions);

  res.status(201).json({
    challenge,
    depositInstructions: {
      hotWalletAddress: config.HOT_WALLET_PUBLIC_KEY,
      memo: challengeId,
      amount: body.poolAmountUsdc,
      asset: "USDC",
      note: `Send exactly ${body.poolAmountUsdc} USDC to the hot wallet with memo: ${challengeId}`,
    },
  });
});

export default router;
