import { Queue, type JobsOptions } from "bullmq";
import { redis } from "../lib/redis";

export const sessionTimeoutJobOptions = {
  attempts: 1,
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 25 },
} satisfies JobsOptions;

export const sessionTimeoutQueue = new Queue("session-timeout", {
  connection: redis,
  defaultJobOptions: sessionTimeoutJobOptions,
});

export async function ensureSessionTimeoutSweepJob(): Promise<void> {
  await sessionTimeoutQueue.add(
    "session-timeout-sweep",
    {},
    {
      jobId: "session-timeout-sweep",
      repeat: { every: 5 * 60_000 },
      removeOnComplete: true,
    }
  );
}
