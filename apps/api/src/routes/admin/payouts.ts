import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate";
import { requireAdmin } from "../../middleware/require-admin";
import { createError } from "../../middleware/error";
import { query } from "../../db/index";
import { enqueuePayoutJob } from "../../queues/payout.queue";
import { logger } from "../../lib/logger";

const router = Router();

router.use(authenticate);
router.use(requireAdmin);

const ListPayoutsSchema = z.object({
  status: z.enum(["all", "pending", "processing", "sent", "confirmed", "failed"]).default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

router.get("/", async (req, res) => {
  const { status, page, pageSize } = ListPayoutsSchema.parse(req.query);

  let whereConditions: string[] = [];
  const params: unknown[] = [];

  if (status !== "all") {
    params.push(status);
    whereConditions.push(`p.status = $${params.length}`);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  const countResult = await query<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM payouts p ${whereClause}`,
    params
  );

  const total = countResult.rows[0]?.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const offset = (page - 1) * pageSize;

  params.push(pageSize, offset);

  const result = await query<{
    id: string;
    challenge_id: string;
    user_id: string;
    username: string;
    stellar_address: string;
    amount_stroops: string;
    amount_usdc: string;
    tx_hash: string | null;
    status: string;
    error_message: string | null;
    created_at: string;
  }>(
    `SELECT
       p.id,
       p.challenge_id,
       p.user_id,
       COALESCE(u.username, u.display_name, 'Unknown') AS username,
       p.stellar_address,
       p.amount_stroops,
       (p.amount_stroops::numeric / 10000000)::numeric(20,7)::text AS amount_usdc,
       p.tx_hash,
       p.status,
       p.error_message,
       p.created_at
     FROM payouts p
     LEFT JOIN users u ON p.user_id = u.id
     ${whereClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params
  );

  // Summary stats
  const statsResult = await query<{
    total_paid_usdc: string;
    total_pending_usdc: string;
    total_failed: number;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('sent', 'confirmed') THEN amount_stroops ELSE 0 END) / 10000000, 0)::numeric(20,7)::text AS total_paid_usdc,
       COALESCE(SUM(CASE WHEN status IN ('pending', 'processing') THEN amount_stroops ELSE 0 END) / 10000000, 0)::numeric(20,7)::text AS total_pending_usdc,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS total_failed
     FROM payouts`
  );

  res.json({
    payouts: result.rows,
    pagination: { page, pageSize, total, totalPages },
    stats: statsResult.rows[0],
  });
});

router.post("/:id/retry", async (req, res) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

  const payout = await query<{
    id: string;
    challenge_id: string;
    status: string;
  }>(
    "SELECT id, challenge_id, status FROM payouts WHERE id = $1",
    [id]
  );

  if (!payout.rows[0]) throw createError("Payout not found", 404);

  const record = payout.rows[0];
  if (record.status !== "failed") {
    throw createError("Only failed payouts can be retried", 400, "NOT_FAILED");
  }

  // Reset status to pending and clear error
  await query(
    "UPDATE payouts SET status = 'pending', error_message = NULL WHERE id = $1",
    [id]
  );

  // Re-enqueue the payout job
  await enqueuePayoutJob(record.challenge_id);

  // Audit log
  await query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_key, after)
     VALUES ($1, 'payout_retry', 'payout', $2, $3::jsonb)`,
    [
      req.user!.sub,
      id,
      JSON.stringify({ payoutId: id, challengeId: record.challenge_id, previousStatus: "failed" }),
    ]
  );

  logger.info("Payout retried by admin", {
    payoutId: id,
    challengeId: record.challenge_id,
    adminId: req.user!.sub,
  });

  res.json({ success: true });
});

export default router;
