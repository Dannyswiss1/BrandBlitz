"use client";

import { useCountdown } from "@/hooks/use-countdown";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface CountdownTimerProps {
  durationSeconds: number;
  onExpire?: () => void;
  className?: string;
}

export function CountdownTimer({ durationSeconds, onExpire, className }: CountdownTimerProps) {
  const { timeLeftMs } = useCountdown({ durationSeconds, onExpire });

  const seconds = Math.ceil(timeLeftMs / 1000);
  const progress = (timeLeftMs / (durationSeconds * 1000)) * 100;
  const isLow = seconds <= 5;

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
