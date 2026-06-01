import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import { findUserById, restoreUser } from "../../db/queries/users";
import {
  createErasureRequest,
  findPendingErasureRequest,
} from "../../db/queries/gdpr";
import { enqueueGdprErasure } from "../../queues/gdpr-erasure.queue";
import { query } from "../../db/index";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

/**
 * POST /admin/users/:userId/erase
 * Trigger a GDPR right-to-erasure for a specific user on behalf of legal/compliance.
 * Subject to the same 30-day grace period as a self-serve request.
 * Every invocation is audit-logged.
 */
router.post("/:userId/erase", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);

  const target = await findUserById(userId);
  if (!target) throw createError("User not found", 404);

  const existing = await findPendingErasureRequest(userId);
  if (existing) throw createError("A deletion request is already pending for this user", 409);

  const erasureRequest = await createErasureRequest(userId, req.user!.sub);
  await enqueueGdprErasure({ userId, requestId: erasureRequest.id });

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, 'gdpr_erasure_request', 'user', $2, $3)`,
    [
      req.user!.sub,
      userId,
      JSON.stringify({ requestId: erasureRequest.id, executeAt: erasureRequest.execute_at }),
    ]
  );

  res.status(202).json({
    message: "GDPR erasure request created. Data will be anonymised after 30 days.",
    requestId: erasureRequest.id,
    executeAt: erasureRequest.execute_at,
  });
});

/**
 * POST /admin/users/:userId/restore
 * Restore a soft-deleted user account.
 */
router.post("/:userId/restore", async (req, res) => {
  const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);

  await restoreUser(userId);

  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key)
     VALUES ($1, 'user_restore', 'user', $2)`,
    [req.user!.sub, userId]
  );

  res.json({ message: "User account has been restored." });
});

export default router;
