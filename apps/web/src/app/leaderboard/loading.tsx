import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function LeaderboardLoading() {
  return (
    <main
      className="max-w-3xl mx-auto px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading leaderboard"
    >
      <Skeleton className="h-9 w-64 mb-2" />
      <Skeleton className="h-5 w-80 mb-8" />

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-48" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-b border-[var(--border)] px-6 py-3 grid grid-cols-[80px_1fr_120px_120px] gap-4">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 ml-auto" />
            <Skeleton className="h-4 w-16 ml-auto" />
          </div>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="border-b border-[var(--border)] last:border-0 px-6 py-4 grid grid-cols-[80px_1fr_120px_120px] gap-4 items-center"
            >
              <Skeleton className="h-5 w-10" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <Skeleton className="h-4 w-36" />
              </div>
              <Skeleton className="h-4 w-20 ml-auto" />
              <Skeleton className="h-4 w-16 ml-auto" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
