import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import { getConfig, setConfig } from "../../db/queries/config";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

const PatchConfigSchema = z.object({
  value: z.record(z.unknown()),
});

/**
 * PATCH /admin/config/:key
 * Update a runtime config value. Audits every change.
 */
router.patch("/:key", async (req, res) => {
  const { value } = PatchConfigSchema.parse(req.body);
  await setConfig(req.params.key, value, req.user!.sub);
  const updated = await getConfig(req.params.key);
  res.json({ key: req.params.key, value: updated });
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
