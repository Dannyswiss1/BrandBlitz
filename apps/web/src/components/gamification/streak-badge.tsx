import { useMemo } from "react";

interface StreakBadgeProps {
  streak?: number | null;
  label?: string;
  showIcon?: boolean;
}

export function StreakBadge({ streak, label = "Streak", showIcon = true }: StreakBadgeProps) {
  const normalizedStreak = typeof streak === "number" && !isNaN(streak) ? streak : 0;

  const displayText = `${normalizedStreak}-day streak`;

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--primary)]/10 px-3 py-1 text-sm font-semibold text-[var(--primary)]">
      {showIcon ? (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--primary)]/15 motion-safe:animate-pulse motion-reduce:animate-none">
          <span aria-hidden="true">🔥</span>
        </span>
      ) : null}
      <span className="leading-none">
        <span className="block text-[var(--foreground)]">{displayText}</span>
        <span className="text-[var(--muted-foreground)] text-xs">{label}</span>
      </span>
    </div>
  );
}
