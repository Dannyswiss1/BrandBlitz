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
  const { limit, offset } = z.object({
    limit: z.coerce.number().min(1).max(100).default(50),
    offset: z.coerce.number().min(0).default(0),
  }).parse(req.query);

  const response = await withCoalescing(`leaderboard:global:${limit}:${offset}`, 300, async () => {
    const challenges = await getActiveChallenges(10);
    const challengeIds = challenges.map((c) => c.id);

    // Cold path: query the pre-computed materialised view instead of a raw
    // aggregate scan, so cache misses are no longer expensive.
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

    const leaderboard = allSessions.slice(offset, offset + limit);

    return {
      leaderboard,
      cachedAt: new Date().toISOString(),
      pagination: {
        limit,
        offset,
        hasMore: offset + leaderboard.length < allSessions.length,
      },
    };
  });

  res.json(response);
});

/**
 * GET /leaderboard/:challengeId
 */
router.get("/:challengeId", async (req, res) => {
  const { limit, offset } = z.object({
    limit: z.coerce.number().default(20),
    offset: z.coerce.number().default(0),
  }).parse(req.query);

  const sessions = await getLeaderboard(req.params.challengeId, limit, offset);

  res.json({
    sessions: sessions.map((s, i) => ({
      rank: offset + i + 1,
      userId: s.user_id,
      username: s.username,
      displayName: s.display_name,
      league: s.league,
      avatarUrl: s.avatar_url,
      totalScore: s.total_score,
      totalEarned: s.total_earned_usdc,
    })),
  });
});

export default router;
