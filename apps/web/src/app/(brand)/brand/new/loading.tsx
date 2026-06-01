import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewBrandLoading() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Skeleton className="mb-2 h-9 w-56" />
      <Skeleton className="mb-8 h-5 w-80" />

      <Card>
        <CardContent className="space-y-6 p-6">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-lg" />
              <Skeleton className="h-10 w-32 rounded-md" />
            </div>
          </div>
          <div className="flex gap-4 pt-4">
            <Skeleton className="h-10 w-32 rounded-md" />
            <Skeleton className="h-10 w-40 rounded-md" />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
