import { Worker, type Job, type WorkerOptions } from "bullmq";
import { redis } from "../../lib/redis";
import { logger } from "../../lib/logger";
import { metrics } from "../../lib/metrics";
import { markAbandonedSessions } from "../../db/queries/sessions";

export const sessionTimeoutWorkerOptions = {
  connection: redis,
  concurrency: 1,
} satisfies WorkerOptions;

export async function processSessionTimeoutJob(_job: Job): Promise<void> {
  const abandonedCount = await markAbandonedSessions();
  for (let index = 0; index < abandonedCount; index += 1) {
    metrics.inc("sessions.abandoned_total");
  }
  logger.info("Session timeout sweep completed", { abandonedCount });
}

export function createSessionTimeoutWorker(WorkerImpl: typeof Worker = Worker): Worker {
  const worker = new WorkerImpl(
    "session-timeout",
    processSessionTimeoutJob,
    sessionTimeoutWorkerOptions
  );

  worker.on("completed", (job) => {
    logger.info("Session timeout job completed", { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error("Session timeout job failed", {
      jobId: job?.id,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  return worker;
}
