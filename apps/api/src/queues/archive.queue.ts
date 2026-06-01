import { Queue, Worker } from "bullmq";
import { redis } from "../lib/redis";
import { query } from "../db";
import { logger } from "../lib/logger";

export const archiveQueue = new Queue("archive", {
  connection: redis,
});

export async function scheduleArchiveJob(): Promise<void> {
  await archiveQueue.add(
    "monthly-archive",
    {},
    {
      jobId: "archive-monthly",
      repeat: { cron: "0 0 0 1 * *" },
      removeOnComplete: true,
    }
  );
}

export function createArchiveWorker(): Worker {
  return new Worker(
    "archive",
    async () => {
      logger.info("Running monthly archive job");
      await query(`
        WITH moved_sessions AS (
          DELETE FROM game_sessions
          WHERE challenge_id IN (
            SELECT id FROM challenges
            WHERE status = 'settled'
              AND ended_at < NOW() - INTERVAL '90 days'
              /* include_deleted */
          )
          RETURNING *
        ),
        archived_sessions AS (
          INSERT INTO game_sessions_archive SELECT * FROM moved_sessions RETURNING id
        ),
        moved_challenges AS (
          DELETE FROM challenges
          WHERE status = 'settled'
            AND ended_at < NOW() - INTERVAL '90 days'
            /* include_deleted */
          RETURNING *
        )
        INSERT INTO challenges_archive SELECT * FROM moved_challenges
      `);
      logger.info("Monthly archive job completed");
    },
    { connection: redis }
  );
}
