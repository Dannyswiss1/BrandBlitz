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
 * inspect failures that exhausted all retries. Optional `?queue=payout-dlq`
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

export default router;
