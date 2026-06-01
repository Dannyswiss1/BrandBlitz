import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeaderboardEntry } from "@/lib/api";
import { LiveGlobalLeaderboard } from "@/components/leaderboard/live-global-leaderboard";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import Link from "next/link";

async function getGlobalLeaderboard(): Promise<{
  entries: LeaderboardEntry[];
  hasMore: boolean;
  failed: boolean;
}> {
  try {
    const res = await api.get("/leaderboard/global?limit=50&offset=0");
    return {
      entries: res.data.leaderboard,
      hasMore: Boolean(res.data.pagination?.hasMore),
      failed: false,
    };
  } catch {
    return {
      entries: [],
      hasMore: false,
      failed: true,
    };
  }
}

export default async function LeaderboardPage() {
  const { entries, hasMore, failed } = await getGlobalLeaderboard();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">Global Leaderboard</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">Top performers across all challenges</p>

      <Card>
        <CardHeader>
          <CardTitle>All-Time Rankings</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {failed ? (
            <div className="p-6">
              <EmptyState
                title="Couldn't load leaderboard"
                description="We couldn't load the rankings right now. Please try again."
                action={
                  <Link href="/leaderboard">
                    <Button variant="outline">Try Again</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <LiveGlobalLeaderboard initial={entries} initialHasMore={hasMore} />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
