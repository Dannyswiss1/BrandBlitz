import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { createError } from "../../middleware/error";
import { findUserById } from "../../db/queries/users";
import { softDeleteChallenge, restoreChallenge } from "../../db/queries/challenges";
import { refundChallenge } from "../../services/refund";
import { query } from "../../db/index";

const router = Router();

router.use(authenticate);

router.use(async (req, _res, next) => {
  const user = await findUserById(req.user!.sub);
  if (!user || user.role !== "admin") throw createError("Forbidden", 403, "FORBIDDEN");
  next();
});

router.post("/:id/refund", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { reason } = z
    .object({ reason: z.string().min(1).max(500).default("manual_refund") })
    .parse(req.body ?? {});

  try {
    const refund = await refundChallenge({ challengeId: id, adminId: req.user!.sub, reason });
    res.status(201).json({ refund });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refund failed";
    if (message === "Challenge not found") throw createError(message, 404);
    if (message === "Challenge already settled")
      throw createError(message, 409, "CHALLENGE_SETTLED");
    if (message === "No deposit found") throw createError(message, 404, "NO_DEPOSIT_FOUND");
    throw error;
  }
});

/**
 * DELETE /admin/challenges/:id
 * Soft-delete a challenge.
 */
router.delete("/:id", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await softDeleteChallenge(id);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key)
     VALUES ($1, 'challenge_soft_delete', 'challenge', $2)`,
    [req.user!.sub, id]
  );

  res.status(204).send();
});

/**
 * POST /admin/challenges/:id/restore
 * Restore a soft-deleted challenge.
 */
router.post("/:id/restore", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  await restoreChallenge(id);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key)
     VALUES ($1, 'challenge_restore', 'challenge', $2)`,
    [req.user!.sub, id]
  );

  res.json({ message: "Challenge has been restored." });
});

export default router;
