"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface QuestionAccuracy {
  round: number;
  questionType: string;
  questionText: string;
  totalAttempts: number;
  correctAttempts: number;
  accuracy: number;
}

interface AccuracyBreakdownChartProps {
  data: QuestionAccuracy[];
  loading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-[var(--muted)] ${className}`} />;
}

function getBarColor(accuracy: number): string {
  if (accuracy >= 80) return "bg-green-500";
  if (accuracy >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

export function AccuracyBreakdownChart({ data, loading = false }: AccuracyBreakdownChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return null;
  }

  const maxAttempts = Math.max(...data.map((q) => q.totalAttempts), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Accuracy by Question</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.map((q) => (
          <div key={`${q.round}-${q.questionType}`} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Round {q.round}</span>
              <span className="text-[var(--muted-foreground)]">
                {q.correctAttempts}/{q.totalAttempts} correct ({q.accuracy}%)
              </span>
            </div>
            <div className="relative h-6 overflow-hidden rounded-full bg-[var(--muted)]">
              <div
                className={`absolute left-0 top-0 h-full rounded-full transition-all ${getBarColor(q.accuracy)}`}
                style={{ width: `${q.accuracy}%` }}
              />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
