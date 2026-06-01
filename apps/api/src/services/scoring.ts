import type { ChallengeQuestion } from "../db/queries/challenges";
import { calculatePayoutShareStroops, stroopsToUsdc, usdcToStroops } from "../lib/usdc";

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 50;
const ROUND_DURATION_MS = 15_000;

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
