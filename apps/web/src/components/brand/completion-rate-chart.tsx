"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CompletionRateChartProps {
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  loading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-[var(--muted)] ${className}`} />;
}

export function CompletionRateChart({
  totalSessions,
  completedSessions,
  completionRate,
  loading = false,
}: CompletionRateChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Completion Rate</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-6">
          <div className="relative h-24 w-24">
            <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                stroke="var(--muted)"
                strokeWidth="3"
              />
              <circle
                cx="18"
                cy="18"
                r="15.9155"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="3"
                strokeDasharray={`${completionRate} ${100 - completionRate}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold">{completionRate}%</span>
            </div>
          </div>
          <div className="space-y-1 text-sm">
            <p>
              <span className="font-medium">{completedSessions.toLocaleString()}</span> completed
            </p>
            <p className="text-[var(--muted-foreground)]">
              of {totalSessions.toLocaleString()} total sessions
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
