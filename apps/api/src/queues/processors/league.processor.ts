import { Worker, type Job, type WorkerOptions } from "bullmq";
import { redis } from "../../lib/redis";
import { logger } from "../../lib/logger";
import { addUtcDays, getUtcWeekStart } from "../../lib/week";
import { query } from "../../db";
import { seedWeekAssignments } from "../../db/queries/leagues";
import { forwardToDlq, leagueDlqQueue } from "../dlq";

export function createLeagueWorker(WorkerCtor: typeof Worker = Worker, opts?: WorkerOptions) {
  const worker = new WorkerCtor(
    "league",
    async (job: Job) => {
      if (job.name === "finalize-week") {
        const weekStart = getUtcWeekStart(new Date());
        logger.info("Finalizing league week", { weekStart, weekEndExclusive: addUtcDays(weekStart, 7) });
        await query("SELECT recalculate_league($1)", [weekStart]);
        return;
      }

      if (job.name === "start-week") {
        const weekStart = getUtcWeekStart(new Date());
        logger.info("Seeding league week", { weekStart });
        await seedWeekAssignments(weekStart);
        return;
      }

      logger.warn("Unknown league job", { name: job.name, id: job.id });
    },
    {
      connection: redis,
      ...opts,
    }
  );

  worker.on("failed", (job, err) => {
    logger.error("League job failed", {
      jobId: job?.id,
      name: job?.name,
      error: err.message,
      attempts: job?.attemptsMade,
    });
    void forwardToDlq(leagueDlqQueue, job, err).catch((dlqErr) => {
      logger.error("Failed to forward league job to DLQ", {
        jobId: job?.id,
        error: (dlqErr as Error).message,
      });
    });
  });

  return worker;
}

