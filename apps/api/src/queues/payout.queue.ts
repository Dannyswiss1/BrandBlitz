import { Queue, type JobsOptions } from "bullmq";
import { redis } from "../lib/redis";

export const payoutJobOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
} satisfies JobsOptions;

export const payoutQueue = new Queue("payout", {
  connection: redis,
  defaultJobOptions: payoutJobOptions,
});

/**
 * Enqueue payout job with deduplication on challenge_id.
 * Uses deterministic jobId to prevent duplicate jobs for the same challenge
 * when multiple events (session close, webhook, admin retry) fire within a short window.
 * BullMQ silently skips duplicate job additions when jobId already exists in waiting/active state.
 */
export async function enqueuePayoutJob(challengeId: string): Promise<void> {
  await payoutQueue.add(
    "process-payout",
    { challengeId },
    {
      ...payoutJobOptions,
      jobId: `payout:${challengeId}`,
    }
  );
}
