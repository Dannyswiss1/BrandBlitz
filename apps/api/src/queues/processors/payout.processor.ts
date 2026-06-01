import { Worker, type Job, type WorkerOptions } from "bullmq";
import { redis } from "../../lib/redis";
import { processPayout } from "../../services/payout";
import { logger } from "../../lib/logger";
import { config } from "../../lib/config";

export const PAYOUT_WORKER_CONCURRENCY = config.PAYOUT_WORKER_CONCURRENCY;

export const payoutWorkerOptions = {
  connection: redis,
  concurrency: PAYOUT_WORKER_CONCURRENCY,
} satisfies WorkerOptions;

export async function processPayoutJob(job: Job<{ challengeId: string }>): Promise<void> {
  logger.info("Processing payout job", { jobId: job.id, challengeId: job.data.challengeId });
  await processPayout(job.data.challengeId);
}

export function createPayoutWorker(WorkerImpl: typeof Worker = Worker): Worker {
  const worker = new WorkerImpl(
    "payout",
    processPayoutJob,
    payoutWorkerOptions
  );

  worker.on("completed", (job) => {
    logger.info("Payout job completed", { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error("Payout job failed", {
      jobId: job?.id,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  return worker;
}