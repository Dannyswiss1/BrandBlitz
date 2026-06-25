import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import { getConfig, setConfig } from "../../db/queries/config";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

const KnownConfigSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.literal("anti_cheat"),
    value: z.object({
      maxSpeedBonusMs: z.number().optional(),
      minReactionTimeMs: z.number().optional(),
    }),
  }),
  z.object({
    key: z.literal("league"),
    value: z.record(z.unknown()), // Fallback schema for league
  }),
  z.object({
    key: z.literal("payout"),
    value: z.record(z.unknown()), // Fallback schema for payout
  })
]);

const PatchConfigSchema = z.object({
  value: z.any(),
});

/**
 * PATCH /admin/config/:key
 * Update a runtime config value. Audits every change.
 */
router.patch("/:key", async (req, res) => {
  const { value } = PatchConfigSchema.parse(req.body);
  const key = req.params.key;

  // Write-time validation and Unknown-key rejection
  const validated = KnownConfigSchema.parse({ key, value });

  await setConfig(key, validated.value, req.user!.sub);
  const updated = await getConfig(key);
  res.json({ key, value: updated });
});

/**
 * GET /admin/config/:key
 * Retrieve a single config value.
 */
router.get("/:key", async (req, res) => {
  const value = await getConfig(req.params.key);
  if (value === null) throw createError("Config key not found", 404, "NOT_FOUND");
  res.json({ key: req.params.key, value });
});

export default router;
