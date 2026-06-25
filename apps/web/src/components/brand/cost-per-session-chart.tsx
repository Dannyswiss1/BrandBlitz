"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface CostDataPoint {
  date: string;
  totalCost: number;
  sessionCount: number;
  costPerSession: number;
}

interface CostPerSessionChartProps {
  data: CostDataPoint[];
  loading?: boolean;
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-[var(--muted)] ${className}`} />;
}

export function CostPerSessionChart({ data, loading = false }: CostPerSessionChartProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-52" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return null;
  }

  const maxCost = Math.max(...data.map((d) => d.costPerSession), 0.01);
  const maxSessions = Math.max(...data.map((d) => d.sessionCount), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cost per Session (30 Days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative h-48">
          <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${data.length * 40} 100`}>
            {data.map((d, i) => {
              const barHeight = (d.costPerSession / maxCost) * 80;
              const x = i * 40 + 8;
              return (
                <g key={d.date}>
                  <rect
                    x={x}
                    y={100 - barHeight}
                    width={24}
                    height={barHeight}
                    fill="var(--primary)"
                    rx={4}
                    opacity={0.8}
                  />
                  <text
                    x={x + 12}
                    y={98 - barHeight}
                    textAnchor="middle"
                    fill="currentColor"
                    fontSize={8}
                    className="fill-[var(--muted-foreground)]"
                  >
                    ${d.costPerSession.toFixed(2)}
                  </text>
                  <text
                    x={x + 12}
                    y={108}
                    textAnchor="middle"
                    fill="currentColor"
                    fontSize={7}
                    className="fill-[var(--muted-foreground)]"
                  >
                    {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-[var(--muted-foreground)]">
          <span>
            Total spent: ${data.reduce((sum, d) => sum + d.totalCost, 0).toFixed(2)}
          </span>
          <span>
            {data.reduce((sum, d) => sum + d.sessionCount, 0).toLocaleString()} sessions
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
