import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BrandAnalyticsLoading() {
  return (
    <main
      className="max-w-4xl mx-auto px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading brand analytics"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-32 rounded-md" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-10 w-44 rounded-md" />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="text-center">
            <CardContent className="pt-6 pb-4 space-y-2">
              <Skeleton className="h-7 w-28 mx-auto" />
              <Skeleton className="h-3 w-24 mx-auto" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-56" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-b border-[var(--border)] px-6 py-3 grid grid-cols-[80px_1fr_120px_120px] gap-4">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16 ml-auto" />
            <Skeleton className="h-4 w-20 ml-auto" />
          </div>
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="border-b border-[var(--border)] last:border-0 px-6 py-3 grid grid-cols-[80px_1fr_120px_120px] gap-4 items-center"
            >
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-4 w-20 ml-auto" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
