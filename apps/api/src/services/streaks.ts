import { metrics } from "../lib/metrics";
import {
  getUserStreak,
  repairUserStreak,
  setUserStreak,
  type StreakState,
} from "../db/queries/users";

const STREAK_MILESTONES = [3, 7, 14, 30] as const;

export interface StreakResponse {
  streak: number;
  lastPlayDay: string | null;
  repairAvailable: boolean;
  nextMilestone: number;
  progress: number;
  milestoneJustHit: boolean;
}

export async function updateStreak(userId: string, now = new Date()): Promise<StreakState> {
  const current = await getUserStreak(userId);
  if (!current) throw new Error("User not found");

  const today = toUtcDay(now);
  const lastPlayDay = normalizeDay(current.last_play_day);

  if (lastPlayDay === today) {
    return current;
  }

  const newStreak = lastPlayDay && dayDiff(lastPlayDay, today) === 1 ? current.streak + 1 : 1;

  const updated = await setUserStreak({
    userId,
    streak: newStreak,
    lastPlayDay: today,
    repairAvailable: newStreak >= 3,
  });

  if (STREAK_MILESTONES.includes(newStreak as any)) {
    metrics.inc("streaks.milestones_reached_total", { milestone: String(newStreak) });
  }

  return updated;
}

export async function getStreak(userId: string, now = new Date()): Promise<StreakResponse> {
  const current = await getUserStreak(userId);
  if (!current) throw new Error("User not found");
  return formatStreak(current, now);
}

export async function repairStreak(
  userId: string,
  now = new Date()
): Promise<StreakResponse | null> {
  const repaired = await repairUserStreak(userId, toUtcDay(now));
  return repaired ? formatStreak(repaired, now) : null;
}

function formatStreak(streak: StreakState, now: Date): StreakResponse {
  const lastPlayDay = normalizeDay(streak.last_play_day);
  const nextMilestone =
    STREAK_MILESTONES.find((m) => m > streak.streak) ??
    STREAK_MILESTONES[STREAK_MILESTONES.length - 1];
  return {
    streak: streak.streak,
    lastPlayDay,
    repairAvailable: streak.streak_repair_available,
    nextMilestone,
    progress: Math.min(1, streak.streak / Math.max(1, nextMilestone)),
    milestoneJustHit:
      STREAK_MILESTONES.includes(streak.streak as any) && lastPlayDay === toUtcDay(now),
  };
}

function toUtcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeDay(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function dayDiff(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}
