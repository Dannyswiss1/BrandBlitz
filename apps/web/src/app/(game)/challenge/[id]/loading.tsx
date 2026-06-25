import { Skeleton } from "@/components/ui/skeleton";

export default function ChallengeLoading() {
  return (
    <div
      className="min-h-screen p-6"
      role="status"
      aria-busy="true"
      aria-label="Loading challenge"
    >
      <div className="mx-auto max-w-lg space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <div className="flex w-32 flex-col items-center gap-2">
            <Skeleton className="h-10 w-14" />
            <Skeleton className="h-3 w-full rounded-full" />
          </div>
        </div>

        <div className="flex justify-center py-4">
          <Skeleton className="h-24 w-56 rounded-lg" />
        </div>

        <div className="space-y-3 text-center">
          <Skeleton className="mx-auto h-6 w-80 max-w-full" />
          <Skeleton className="mx-auto h-6 w-64 max-w-full" />
        </div>

        <div className="grid grid-cols-1 gap-3">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className="flex h-[54px] items-center gap-3 rounded-md border border-[var(--border)] px-4"
            >
              <Skeleton className="h-6 w-7 rounded" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
