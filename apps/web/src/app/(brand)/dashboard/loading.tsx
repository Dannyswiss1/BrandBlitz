import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main
      className="max-w-5xl mx-auto px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading brand dashboard"
    >
      <div className="flex items-center justify-between mb-8">
        <div className="space-y-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-80" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Skeleton className="h-12 w-24 rounded-md" />
                  <div className="space-y-2">
                    <CardTitle>
                      <Skeleton className="h-5 w-48" />
                    </CardTitle>
                    <Skeleton className="h-4 w-28" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-28 rounded-md" />
                  <Skeleton className="h-8 w-32 rounded-md" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                  <Skeleton className="h-4 w-16 ml-auto" />
                </div>
                {Array.from({ length: 2 }).map((__, rowIdx) => (
                  <div key={rowIdx} className="grid grid-cols-4 gap-4 items-center">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-4 w-16 ml-auto" />
                    <Skeleton className="h-4 w-8 ml-auto" />
                    <Skeleton className="h-4 w-20 ml-auto" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
