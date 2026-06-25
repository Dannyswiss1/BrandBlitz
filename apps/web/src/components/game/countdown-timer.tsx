"use client";

import * as React from "react";
import { useCountdown } from "@/hooks/use-countdown";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CountdownTimerProps {
  durationSeconds: number;
  /**
   * Server-authoritative deadline as a Unix timestamp in milliseconds.
   * When provided the hook re-syncs against this value on tab-focus restore
   * instead of resuming stale client state (#346).
   */
  deadlineAt?: number;
  onExpire?: () => void;
  /** Called each second when countdown is ≤5 s for tick sound. */
  onTick?: () => void;
  className?: string;
  paused?: boolean;
}

export function CountdownTimer({ durationSeconds, deadlineAt, onExpire, className, paused = false }: CountdownTimerProps) {
  const { timeLeftMs } = useCountdown({ durationSeconds, deadlineAt, onExpire, paused });

  const seconds = Math.ceil(timeLeftMs / 1000);
  const totalMs = Math.max(durationSeconds, 1) * 1000;
  const progress = (timeLeftMs / totalMs) * 100;
  const isLow = seconds <= 5;

  React.useEffect(() => {
    if (isLow && seconds < prevSecondsRef.current && onTick) {
      onTick();
    }
    prevSecondsRef.current = seconds;
  }, [seconds, isLow, onTick]);

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <span
        className={cn(
          "text-4xl font-bold tabular-nums transition-colors",
          isLow ? "text-red-500 animate-pulse" : "text-[var(--foreground)]"
        )}
      >
        {seconds}
      </span>
      <Progress
        value={progress}
        className={cn("w-full h-3", isLow && "[&>div]:bg-red-500")}
      />
    </div>
  );
}
