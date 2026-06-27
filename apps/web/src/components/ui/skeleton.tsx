import * as React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "skeleton-shimmer rounded-md bg-[var(--muted)]",
        className
      )}
      {...props}
    />
  );
}

export function TableSkeleton({ rows = 5, cols }: { rows?: number; cols?: number }) {
  return (
    <div>
      <div className="grid grid-cols-[80px_1fr_120px_120px] gap-4 border-b border-[var(--border)] px-6 py-3">
        {Array.from({ length: cols ?? 4 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[80px_1fr_120px_120px] items-center gap-4 border-b border-[var(--border)] px-6 py-3 last:border-0"
        >
          {Array.from({ length: cols ?? 4 }).map((_, ci) => (
            <Skeleton key={ci} className={cn("h-4", ci === 1 ? "w-36" : "ml-auto w-16")} />
          ))}
        </div>
      ))}
    </div>
  );
}
