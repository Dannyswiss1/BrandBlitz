import { describe, expect, it } from "vitest";
import { scoresForResume, shouldShowRecoveryModal } from "./session-recovery";

describe("session recovery helpers", () => {
  it("detects resumable in-progress sessions with answered rounds", () => {
    expect(shouldShowRecoveryModal({
      status: "in_progress",
      last_answered_round: 2,
      current_round: 3,
      remaining_time_ms: 12000,
      total_score: 180,
    })).toBe(true);
  });

  it("does not show the recovery modal for completed or untouched sessions", () => {
    expect(shouldShowRecoveryModal({
      status: "completed",
      last_answered_round: 3,
      current_round: 3,
      remaining_time_ms: 0,
      total_score: 300,
    })).toBe(false);

    expect(shouldShowRecoveryModal({
      status: "in_progress",
      last_answered_round: 0,
      current_round: 1,
      remaining_time_ms: 45000,
      total_score: 0,
    })).toBe(false);
  });

  it("shows expired sessions and only resumes completed score rounds", () => {
    const session = {
      status: "expired" as const,
      last_answered_round: 2,
      current_round: 3,
      remaining_time_ms: 0,
      total_score: 210,
      round_scores: [100, 110, 0],
    };

    expect(shouldShowRecoveryModal(session)).toBe(true);
    expect(scoresForResume(session)).toEqual([100, 110]);
  });

  it("falls back to total score when detailed round scores are absent", () => {
    expect(scoresForResume({
      status: "in_progress",
      last_answered_round: 1,
      current_round: 2,
      remaining_time_ms: 20000,
      total_score: 90,
    })).toEqual([90]);
  });
});
