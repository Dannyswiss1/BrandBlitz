export interface SessionRecoverySnapshot {
  status: "warmup" | "in_progress" | "completed" | "expired";
  last_answered_round: number;
  current_round: number;
  remaining_time_ms: number;
  total_score: number;
  round_scores?: number[];
}

export function shouldShowRecoveryModal(session: SessionRecoverySnapshot): boolean {
  return session.status === "expired" || (session.status === "in_progress" && session.last_answered_round > 0);
}

export function scoresForResume(session: SessionRecoverySnapshot): number[] {
  const scores = (session.round_scores ?? [])
    .slice(0, Math.max(0, session.last_answered_round))
    .filter((score): score is number => typeof score === "number");

  if (scores.length > 0) return scores;
  return session.total_score > 0 ? [session.total_score] : [];
}
