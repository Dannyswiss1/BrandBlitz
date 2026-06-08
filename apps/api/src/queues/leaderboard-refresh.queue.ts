import { Queue, Worker, type JobsOptions, type WorkerOptions } from "bullmq";
import { redis } from "../lib/redis";
import { query } from "../db";
import { logger } from "../lib/logger";
import { metrics } from "../lib/metrics";

export const leaderboardRefreshJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 25 },
} satisfies JobsOptions;

export const leaderboardRefreshQueue = new Queue("leaderboard-refresh", {
  connection: redis,
  defaultJobOptions: leaderboardRefreshJobOptions,
});

export async function enqueueLeaderboardRefresh(challengeId: string): Promise<void> {
  await leaderboardRefreshQueue.add(
    "refresh",
    { challengeId },
    leaderboardRefreshJobOptions
  );
  logger.info("Leaderboard refresh job enqueued", { challengeId });
}

export async function refreshLeaderboardView(): Promise<void> {
  await query("REFRESH MATERIALIZED VIEW CONCURRENTLY v_leaderboard_global");
  await invalidateLeaderboardCache();
  metrics.inc("leaderboard.view_refresh_total");
}

async function invalidateLeaderboardCache(): Promise<void> {
  let cursor = 0;
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "leaderboard:global:*",
      "COUNT",
      100
    );
    cursor = Number(next);
    if (keys.length > 0) {
      await redis.del(...(keys as [string, ...string[]]));
    }
  } while (cursor !== 0);
}

export function createLeaderboardRefreshWorker(
  WorkerCtor: typeof Worker = Worker,
  opts?: WorkerOptions
): Worker {
  const worker = new WorkerCtor(
    "leaderboard-refresh",
    async (job) => {
      logger.info("Refreshing v_leaderboard_global", { jobId: job.id });
      await refreshLeaderboardView();
    },
    { connection: redis, ...opts }
  );

  worker.on("completed", (job) => {
    logger.info("Leaderboard refresh completed", { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    logger.error("Leaderboard refresh failed", {
      jobId: job?.id,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  return worker;
}
