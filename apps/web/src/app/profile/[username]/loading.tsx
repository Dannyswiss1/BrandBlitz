import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <main
      className="max-w-2xl mx-auto px-6 py-12"
      role="status"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="flex items-center gap-6 mb-10">
        <Skeleton className="h-20 w-20 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-32 mt-2" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx} className="text-center">
            <CardContent className="pt-6 pb-4 space-y-2">
              <Skeleton className="h-8 w-24 mx-auto" />
              <Skeleton className="h-3 w-20 mx-auto" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-24" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="flex flex-col items-center gap-2 rounded-md border border-[var(--border)] p-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Skeleton className="h-6 w-44" />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="border-b border-[var(--border)] last:border-0 px-6 py-3 grid grid-cols-[1fr_120px_80px] gap-4 items-center"
            >
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-4 w-10 ml-auto" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
