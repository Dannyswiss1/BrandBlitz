import { Queue, type JobsOptions } from "bullmq";
import { redis } from "../lib/redis";

export const leagueJobOptions = {
  attempts: 2,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
} satisfies JobsOptions;

export const leagueQueue = new Queue("league", {
  connection: redis,
  defaultJobOptions: leagueJobOptions,
});

export async function ensureLeagueRepeatableJobs(): Promise<void> {
  // Sunday 23:59 UTC — finalize week (rank + promoted/demoted flags)
  // jobId ensures idempotent repeatable job registration
  await leagueQueue.add(
    "finalize-week",
    {},
    {
      jobId: "league:finalize-week",
      repeat: { pattern: "59 23 * * 0", tz: "UTC" },
    }
  );

  // Monday 00:00 UTC — seed new week assignments (new users => bronze)
  await leagueQueue.add(
    "start-week",
    {},
    {
      jobId: "league:start-week",
      repeat: { pattern: "0 0 * * 1", tz: "UTC" },
    }
  );
}

