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
