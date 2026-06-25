import type { ChallengeQuestion } from "../db/queries/challenges";
import type { PoolClient } from "pg";
import { calculatePayoutShareStroops, stroopsToUsdc, usdcToStroops } from "../lib/usdc";
import type { GameSession } from "../db/queries/sessions";

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const ROUND_DURATION_MS = 15_000;

export const MAX_ROUND_SCORE = BASE_POINTS + MAX_SPEED_BONUS;
export const MAX_TOTAL_SCORE = MAX_ROUND_SCORE * 3;

export interface ScoreValidationError {
  valid: false;
  code: string;
  message: string;
  score: number;
}

export function validateRoundScore(score: number): ScoreValidationError | { valid: true } {
  if (!Number.isFinite(score) || score < 0 || score > MAX_ROUND_SCORE) {
    return {
      valid: false,
      code: "ROUND_SCORE_OUT_OF_RANGE",
      message: `Round score ${score} is outside valid range [0, ${MAX_ROUND_SCORE}]`,
      score,
    };
  }
  return { valid: true };
}

export function validateTotalScore(score: number): ScoreValidationError | { valid: true } {
  if (!Number.isFinite(score) || score < 0 || score > MAX_TOTAL_SCORE) {
    return {
      valid: false,
      code: "TOTAL_SCORE_OUT_OF_RANGE",
      message: `Total score ${score} is outside valid range [0, ${MAX_TOTAL_SCORE}]`,
      score,
    };
  }
  return { valid: true };
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const { pool } = await import("../db");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function isLockTimeout(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "55P03"
  );
}

function createServiceError(message: string, statusCode: number, code?: string): Error {
  const error = new Error(message) as Error & { statusCode?: number; code?: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export async function completeWarmupWithLock(params: {
  userId: string;
  challengeId: string;
  nowMs?: () => number;
}): Promise<GameSession> {
  const nowMs = params.nowMs ?? Date.now;
  const [{ config }, { redis }] = await Promise.all([
    import("../lib/config"),
    import("../lib/redis"),
  ]);

  try {
    return await withTransaction(async (client) => {
      await client.query("SELECT set_config('lock_timeout', $1, true)", [
        `${config.WARMUP_COMPLETE_LOCK_TIMEOUT_MS}ms`,
      ]);

      const sessionResult = await client.query<GameSession>(
        `SELECT *
         FROM game_sessions
         WHERE user_id = $1
           AND challenge_id = $2
         FOR UPDATE`,
        [params.userId, params.challengeId]
      );
      const session = sessionResult.rows[0];
      if (!session) throw createServiceError("Session not found", 404);

      if (session.warmup_completed_at) {
        throw createServiceError("Warm-up already completed", 409, "WARMUP_ALREADY_COMPLETED");
      }

      const unlockAt = await redis.get(`warmup:unlock:${session.id}`);
      if (unlockAt) {
        const remainingMs = parseInt(unlockAt, 10) - nowMs();
        if (remainingMs > 0) {
          const error = createServiceError("Warm-up minimum not yet elapsed", 400, "WARMUP_TOO_FAST");
          (error as any).remainingMs = remainingMs;
          throw error;
        }
      }

      const completedResult = await client.query<GameSession>(
        `UPDATE game_sessions
         SET warmup_completed_at = NOW()
         WHERE id = $1
           AND warmup_completed_at IS NULL
         RETURNING *`,
        [session.id]
      );
      const completed = completedResult.rows[0];
      if (!completed) {
        throw createServiceError("Warm-up already completed", 409, "WARMUP_ALREADY_COMPLETED");
      }

      return completed;
    });
  } catch (error) {
    if (isLockTimeout(error)) {
      throw createServiceError("Warm-up completion is already in progress", 409, "WARMUP_LOCK_TIMEOUT");
    }
    throw error;
  }
}

/**
 * Calculate score for a single round answer.
 *
 * Score = BASE_POINTS (if correct) + speed bonus
 * Speed bonus: linear over 15s window. 50 pts at instant answer, 0 pts at 15s.
 *
 * Max per round: 150. Max total: 450.
 */
export function calculateRoundScore(params: {
  selectedOption: "A" | "B" | "C" | "D" | null;
  correctOption: "A" | "B" | "C" | "D";
  reactionTimeMs: number;
}): number {
  const { selectedOption, correctOption, reactionTimeMs } = params;

  if (selectedOption !== correctOption) return 0;

  const timeLeft = Math.max(0, ROUND_DURATION_MS - reactionTimeMs);
  const speedBonus = Math.floor((timeLeft / ROUND_DURATION_MS) * MAX_SPEED_BONUS);

  return BASE_POINTS + speedBonus;
}

/**
 * Validate that the selected option matches the stored correct option for a question.
 * Questions are stored server-side — answers are NEVER sent to the client.
 */
export function validateAnswer(
  question: ChallengeQuestion,
  selectedOption: "A" | "B" | "C" | "D" | null
): boolean {
  return question.correct_option === selectedOption;
}

/**
 * Calculate payout amount for a winner based on their share of total points.
 * Returns 7-decimal USDC amount as string (Stellar convention).
 *
 * Round-score aggregation upstream uses `COALESCE(SUM(score), 0)` (see
 * db/queries/sessions.ts), so sessions whose `session_round_scores` rows are
 * absent — e.g. archived/pruned challenges — contribute a score of 0 rather
 * than producing NULLs. `calculatePayoutShareStroops` additionally guards
 * `totalPointsAllUsers === 0`, so a fully-empty scoreboard yields a 0 share
 * instead of a divide-by-zero. Missing round scores are therefore handled
 * gracefully end to end.
 */
export function calculatePayoutShare(
  userScore: number,
  totalPointsAllUsers: number,
  poolAmountUsdc: string
): string {
  const stroops = calculatePayoutShareStroops(
    userScore,
    totalPointsAllUsers,
    usdcToStroops(poolAmountUsdc)
  );
  return stroopsToUsdc(stroops);
}

/**
 * Deduplicate badge slug candidates before passing them to the badge-award
 * pipeline. The DB layer already enforces uniqueness via
 * ON CONFLICT (user_id, badge_slug) DO NOTHING, but filtering here
 * eliminates redundant round-trips when a scoring event fires twice
 * due to a retry (#358).
 *
 * @param slugs - Potentially duplicate list of badge slugs to award.
 * @returns Array with each slug appearing at most once, in insertion order.
 */
export function deduplicateBadgeSlugs(slugs: string[]): string[] {
  return [...new Set(slugs)];
}

/**
 * Get top-N winners from sessions eligible for payout.
 * Sorted by total_score DESC, then completed_at ASC (tiebreaker: fastest finish).
 */
export interface SessionSummary {
  userId: string;
  stellarAddress: string;
  totalScore: number;
  endedAt: string;
}

export function rankWinners(
  sessions: SessionSummary[],
  topN?: number
): SessionSummary[] {
  const sorted = [...sessions].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;

    const endedAtA = new Date(a.endedAt).getTime();
    const endedAtB = new Date(b.endedAt).getTime();
    if (endedAtA !== endedAtB) return endedAtA - endedAtB;

    return a.userId.localeCompare(b.userId);
  });

  return topN ? sorted.slice(0, topN) : sorted;
}
