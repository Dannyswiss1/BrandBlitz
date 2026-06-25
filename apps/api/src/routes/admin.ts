import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/authenticate";
import { getArchivedChallengeById } from "../db/queries/challenges";
import { findUserById } from "../db/queries/users";
import { createError } from "../middleware/error";
import { logger } from "../lib/logger";
import {
  DLQ_QUEUES,
  DLQ_SOURCE_QUEUES,
  type DeadLetterPayload,
} from "../queues/dlq";
import { feeBumpTransaction } from "@brandblitz/stellar";
import { updatePayoutFeeBumpStatus } from "../db/queries/payouts";
import { config } from "../lib/config";
import { query } from "../db/index";

const router = Router();

router.use(authenticate);

router.use(async (req, _res, next) => {
  const user = await findUserById(req.user!.sub);
  if (!user || user.role !== "admin") throw createError("Forbidden", 403, "FORBIDDEN");
  next();
});

router.get("/archive/challenges/:id", async (req, res) => {
  const challenge = await getArchivedChallengeById(req.params.id);
  if (!challenge) throw createError("Archived challenge not found", 404);
  res.json({ challenge });
});

// ── Dead-letter queue inspection & manual retry ─────────────────────────────

/**
 * GET /admin/dlq
 * List jobs currently sitting in every dead-letter queue so operators can
 * inspect failures that exhausted all retries. Optional `?queue=payout:dlq`
 * narrows to a single DLQ.
 */
router.get("/dlq", async (req, res) => {
  const queueFilter = req.query.queue;
  const names = Object.keys(DLQ_QUEUES);

  if (typeof queueFilter === "string" && !DLQ_QUEUES[queueFilter]) {
    throw createError(`Unknown DLQ: ${queueFilter}`, 400);
  }

  const targets =
    typeof queueFilter === "string" ? [queueFilter] : names;

  const queues = await Promise.all(
    targets.map(async (name) => {
      const queue = DLQ_QUEUES[name];
      const jobs = await queue.getJobs(
        ["waiting", "active", "completed", "failed", "delayed"],
        0,
        99,
      );
      return {
        queue: name,
        count: jobs.length,
        jobs: jobs.map((job) => {
          const data = job.data as DeadLetterPayload;
          return {
            id: job.id,
            name: job.name,
            originalQueue: data?.originalQueue,
            originalJobId: data?.originalJobId,
            failedReason: data?.failedReason,
            attemptsMade: data?.attemptsMade,
            failedAt: data?.failedAt,
            data: data?.data,
          };
        }),
      };
    }),
  );

  res.json({ queues });
});

/**
 * POST /admin/dlq/:queue/:jobId/retry
 * Replay a dead-lettered job onto its original queue, then remove it from the
 * DLQ. The replay is recorded against the admin who triggered it.
 */
router.post("/dlq/:queue/:jobId/retry", async (req, res) => {
  const { queue: queueName, jobId } = z
    .object({ queue: z.string(), jobId: z.string() })
    .parse(req.params);

  const dlqQueue = DLQ_QUEUES[queueName];
  const sourceQueue = DLQ_SOURCE_QUEUES[queueName];
  if (!dlqQueue || !sourceQueue) {
    throw createError(`Unknown DLQ: ${queueName}`, 400);
  }

  const job = await dlqQueue.getJob(jobId);
  if (!job) throw createError("DLQ job not found", 404);

  const payload = job.data as DeadLetterPayload;
  const replay = await sourceQueue.add(payload.jobName, payload.data);
  await job.remove();

  logger.info("DLQ job manually retried", {
    adminId: req.user!.sub,
    dlq: queueName,
    dlqJobId: jobId,
    replayedJobId: replay.id,
  });

  res.json({ retried: true, replayedJobId: replay.id });
});

// ── Fee Bump Transaction Recovery ────────────────────────────────────────────

/**
 * POST /admin/payouts/:id/fee-bump
 * Manually trigger a fee bump for a stuck payout transaction.
 * Admin can specify a custom max fee or use 2x current base fee.
 */
router.post("/payouts/:id/fee-bump", async (req, res) => {
  const { id: payoutId } = z.object({ id: z.string().uuid() }).parse(req.params);
  const { customMaxFeeStroops } = z
    .object({
      customMaxFeeStroops: z.number().int().min(100).optional(),
    })
    .parse(req.body);

  // Fetch payout
  const payout = await query<{
    id: string;
    tx_hash: string | null;
    fee_bump_attempts: number;
    status: string;
  }>(
    `SELECT id, tx_hash, fee_bump_attempts, status FROM payouts WHERE id = $1`,
    [payoutId]
  );

  if (!payout.rows[0]) {
    throw createError("Payout not found", 404);
  }

  const payoutRecord = payout.rows[0];

  if (!payoutRecord.tx_hash) {
    throw createError("Payout has no transaction hash to bump", 400);
  }

  if (payoutRecord.fee_bump_attempts >= 3) {
    throw createError("Maximum fee bump attempts (3) exceeded", 400);
  }

  // Get current base fee from Horizon
  const horizon = require("@brandblitz/stellar").getHorizonServer(config.STELLAR_NETWORK);
  let baseFee = 100; // Default
  try {
    const ledger = await horizon.ledgers().order("desc").limit(1).call();
    baseFee = ledger.records[0]?.base_fees_in_stroops ?? 100;
  } catch (err) {
    logger.warn("Failed to fetch base fee from Horizon, using default", { err });
  }

  // Calculate fee bump max fee
  const maxFeeStroops = customMaxFeeStroops ?? baseFee * 2;

  // Check ceiling from app_config
  const configResult = await query<{ value: { maxFee: number } }>(
    `SELECT value FROM app_config WHERE key = 'payout_max_fee_stroops'`
  );
  const maxFeeCeiling = configResult.rows[0]?.value?.maxFee ?? 5000;

  if (maxFeeStroops > maxFeeCeiling) {
    throw createError(
      `Requested fee ${maxFeeStroops} exceeds ceiling ${maxFeeCeiling}`,
      400,
      "FEE_EXCEEDS_CEILING"
    );
  }

  try {
    // Mark as fee_bump_pending
    await updatePayoutFeeBumpStatus(
      payoutId,
      "fee_bump_pending",
      maxFeeStroops,
      payoutRecord.tx_hash
    );

    // Submit fee bump
    const result = await feeBumpTransaction(
      payoutRecord.tx_hash,
      maxFeeStroops,
      config.HOT_WALLET_SECRET,
      config.STELLAR_NETWORK as any
    );

    // Mark as completed with new fee bump tx hash
    await query(
      `UPDATE payouts
       SET status = 'completed', tx_hash = $2, updated_at = NOW()
       WHERE id = $1`,
      [payoutId, result.feeBumpHash]
    );

    logger.info("Fee bump submitted successfully", {
      payoutId,
      originalTx: payoutRecord.tx_hash,
      feeBumpTx: result.feeBumpHash,
      maxFee: maxFeeStroops,
      adminId: req.user!.sub,
    });

    res.json({
      success: true,
      payout: {
        id: payoutId,
        originalTx: payoutRecord.tx_hash,
        feeBumpTx: result.feeBumpHash,
        maxFee: maxFeeStroops,
      },
    });
  } catch (error) {
    // Mark as fee_bump_failed
    await updatePayoutFeeBumpStatus(
      payoutId,
      "fee_bump_failed",
      maxFeeStroops,
      payoutRecord.tx_hash
    );

    logger.error("Fee bump submission failed", {
      payoutId,
      error: error instanceof Error ? error.message : String(error),
    });

    throw createError(
      "Fee bump submission failed",
      500,
      "FEE_BUMP_FAILED"
    );
  }
});

export default router;
