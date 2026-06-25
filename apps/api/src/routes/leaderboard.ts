import { Router } from "express";
import { z } from "zod";
import { getActiveChallenges } from "../db/queries/challenges";
import {
  getLeaderboard,
  getTopSessionsPerChallenge,
  getGlobalLeaderboardFromView,
} from "../db/queries/sessions";
import { withCoalescing } from "../lib/cache";

const router = Router();

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
      const sessions = await getLeaderboard(challengeId, 100, 0);
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

    const challenges = await getActiveChallenges(10);
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
  const { limit, cursor } = z.object({
    limit: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().optional(),
  }).parse(req.query);

  const cacheKey = cursor
    ? `leaderboard:global:${cursor}:${limit}`
    : `leaderboard:global:first:${limit}`;

  const response = await withCoalescing(cacheKey, 300, async () => {
    const challenges = await getActiveChallenges(10);
    const challengeIds = challenges.map((c) => c.id);

    const viewRows = await getGlobalLeaderboardFromView(challengeIds, 10);

    const allSessions = viewRows.map((s) => ({
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

    // Apply cursor filter
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = allSessions.findIndex((s) => s.rank > Number(cursor));
      startIndex = cursorIndex >= 0 ? cursorIndex : allSessions.length;
    }

    const page = allSessions.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < allSessions.length;
    const nextCursor = page.length > 0 ? String(page[page.length - 1].rank) : null;

    return {
      data: page,
      nextCursor: hasMore ? nextCursor : null,
      cachedAt: new Date().toISOString(),
    };
  });

  res.json(response);
});

/**
 * GET /leaderboard/:challengeId
 */
router.get("/:challengeId", async (req, res) => {
  const { limit, cursor } = z.object({
    limit: z.coerce.number().default(20),
    cursor: z.string().optional(),
  }).parse(req.query);

  // cursor is last seen total_score,encoded as just the score value
  // We fetch limit+1 to detect if there are more
  let cursorScore: number | undefined;
  let cursorId: string | undefined;
  if (cursor) {
    const parts = cursor.split(":");
    cursorScore = Number(parts[0]);
    cursorId = parts[1];
  }

  const sessions = await getLeaderboard(req.params.challengeId, limit + 1, 0);

  // Apply cursor filter on the result set
  let filtered = sessions;
  if (cursorScore !== undefined && cursorId !== undefined) {
    filtered = sessions.filter(s =>
      s.total_score < cursorScore ||
      (s.total_score === cursorScore && s.id > cursorId)
    );
  }

  const hasMore = filtered.length > limit;
  const page = filtered.slice(0, limit);

  const lastItem = page[page.length - 1];
  const nextCursor = lastItem ? `${lastItem.total_score}:${lastItem.id}` : null;

  res.json({
    data: page.map((s, i) => ({
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
    nextCursor: hasMore ? nextCursor : null,
  });
});

export default router;
