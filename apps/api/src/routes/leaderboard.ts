import { Router } from "express";
import { z } from "zod";
import { getActiveChallenges } from "../db/queries/challenges";
import {
  getLeaderboard,
  getTopSessionsPerChallenge,
  getGlobalLeaderboardFromView,
  LEADERBOARD_SORTS,
  type LeaderboardSort,
} from "../db/queries/sessions";
import { withCoalescing } from "../lib/cache";
import { CursorQuerySchema } from "../db/pagination";
import { createError } from "../middleware/error";

const router = Router();

const LEADERBOARD_CACHE_TTL_SEC = 30;

// Keep leaderboard ORDER BY clauses static or selected from this allowlist only.
// User query params must never be concatenated directly into SQL strings.
const LeaderboardSortSchema = z.enum(LEADERBOARD_SORTS).default("score");

function parseLeaderboardSort(query: unknown): LeaderboardSort {
  const raw =
    typeof query === "object" && query !== null
      ? ((query as Record<string, unknown>).sort_by ?? (query as Record<string, unknown>).order)
      : undefined;
  const parsed = LeaderboardSortSchema.safeParse(raw);
  if (!parsed.success) {
    throw createError(
      `Invalid leaderboard sort. Allowed values: ${LEADERBOARD_SORTS.join(", ")}`,
      400,
      "INVALID_SORT"
    );
  }
  return parsed.data;
}

function writeSse(res: any, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * GET /leaderboard/stream
 * Server-Sent Events feed for global or per-challenge leaderboard snapshots.
 *
 * Query params:
 *  - challengeId?: string
 *  - intervalMs?: number (default 2000, min 500)
 */
router.get("/stream", async (req, res) => {
  parseLeaderboardSort(req.query);
  const { challengeId, intervalMs } = z.object({
    challengeId: z.string().optional(),
    intervalMs: z.coerce.number().min(500).max(30_000).default(2000),
  }).parse(req.query);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendSnapshot = async () => {
    if (challengeId) {
      const { sessions } = await getLeaderboard(challengeId, 100);
      writeSse(res, {
        challengeId,
        sessions: sessions.map((s, i) => ({
          rank: i + 1,
          userId: s.user_id,
          username: s.username,
          displayName: s.display_name,
          league: s.league,
          avatarUrl: s.avatar_url,
          totalScore: s.total_score,
          totalEarned: s.total_earned_usdc,
          endedAt: s.completed_at,
        })),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const { challenges } = await getActiveChallenges(10);
    const challengeIds = challenges.map((c) => c.id);
    const topSessions = await getTopSessionsPerChallenge(challengeIds, 10);

    const rankPerChallenge = new Map<string, number>();
    const leaderboard = topSessions.map((s) => {
      const rank = (rankPerChallenge.get(s.challenge_id) ?? 0) + 1;
      rankPerChallenge.set(s.challenge_id, rank);
      return {
        rank,
        challengeId: s.challenge_id,
        userId: s.user_id,
        username: s.username,
        displayName: s.display_name,
        league: s.league,
        avatarUrl: s.avatar_url,
        totalScore: s.total_score,
        totalEarned: s.total_earned_usdc,
      };
    });

    writeSse(res, { leaderboard, updatedAt: new Date().toISOString() });
  };

  const heartbeat = setInterval(() => res.write(`:keep-alive\n\n`), 15_000);

  try {
    await sendSnapshot();
  } catch {
    // ignore initial snapshot error; clients will fall back to polling
  }

  const timer = setInterval(() => {
    sendSnapshot().catch(() => {});
  }, intervalMs);

  req.on("close", () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  });
});

/**
 * GET /leaderboard/global
 * Cross-challenge leaderboard (cached in Redis, 5 min TTL).
 * Single aggregated query via ROW_NUMBER() — no N+1.
 */
router.get("/global", async (req, res) => {
  const sortBy = parseLeaderboardSort(req.query);
  const { limit } = CursorQuerySchema.parse(req.query);

  const response = await withCoalescing(`leaderboard:global:${sortBy}:${limit}`, 300, async () => {
    const { challenges } = await getActiveChallenges(10);
    const challengeIds = challenges.map((c) => c.id);

    const viewRows = await getGlobalLeaderboardFromView(challengeIds, 10);

    const data = viewRows.map((s) => ({
      rank: s.rank,
      challengeId: s.challenge_id,
      userId: s.user_id,
      username: s.username,
      displayName: s.display_name,
      league: s.league,
      avatarUrl: s.avatar_url,
      totalScore: s.total_score,
      totalEarned: s.total_earned_usdc,
    }));

    return {
      data,
      nextCursor: null,
      cachedAt: new Date().toISOString(),
    };
  });

  res.json(response);
});

/**
 * GET /leaderboard/:challengeId
 * Paginated leaderboard for a challenge. Supports keyset cursor pagination.
 */
router.get("/:challengeId", async (req, res) => {
  const sortBy = parseLeaderboardSort(req.query);
  const { limit, cursor } = CursorQuerySchema.parse(req.query);

  const cacheKey = `leaderboard:${sortBy}:${req.params.challengeId}:${limit}:${cursor ?? ""}`;

  const responseBody = await withCoalescing(cacheKey, LEADERBOARD_CACHE_TTL_SEC, async () => {
    const result = await getLeaderboard(req.params.challengeId, limit, cursor, sortBy);

    const mappedSessions = result.sessions.map((s, i) => ({
      rank: i + 1,
      userId: s.user_id,
      username: s.username,
      displayName: s.display_name,
      league: s.league,
      avatarUrl: s.avatar_url,
      totalScore: s.total_score,
      totalEarned: s.total_earned_usdc,
    }));

    return {
      sessions: mappedSessions,
      data: mappedSessions,
      nextCursor: result.nextCursor,
    };
  });

  res.json(responseBody);
});
});

export default router;
