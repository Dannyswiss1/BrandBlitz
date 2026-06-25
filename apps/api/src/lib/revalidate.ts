import { config } from "./config";
import { logger } from "./logger";

/**
 * Trigger on-demand Next.js ISR revalidation for the leaderboard page.
 * Called after score commits to ensure high-impact updates propagate quickly.
 */
export async function revalidateLeaderboard(): Promise<void> {
  if (!config.NEXT_REVALIDATE_URL || !config.REVALIDATE_SECRET) {
    logger.debug("Skipping revalidation: NEXT_REVALIDATE_URL or REVALIDATE_SECRET not configured");
    return;
  }

  try {
    const response = await fetch(`${config.NEXT_REVALIDATE_URL}/api/revalidate/leaderboard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret: config.REVALIDATE_SECRET,
      }),
    });

    if (!response.ok) {
      logger.warn("Leaderboard revalidation failed", {
        status: response.status,
        statusText: response.statusText,
      });
      return;
    }

    const data = await response.json();
    logger.info("Leaderboard revalidated", { data });
  } catch (error) {
    logger.error("Failed to trigger leaderboard revalidation", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
