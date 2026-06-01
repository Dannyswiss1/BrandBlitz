"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api";
import { formatScore, formatUsdc } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/api";

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };
const PAGE_SIZE = 50;
const STORAGE_KEY = "brandblitz:leaderboard:global";

async function fetchLeaderboardPage(offset: number): Promise<{
  entries: LeaderboardEntry[];
  hasMore: boolean;
}> {
  const res = await api.get(`/leaderboard/global?limit=${PAGE_SIZE}&offset=${offset}`);
  const entries: LeaderboardEntry[] = res.data.leaderboard;
  const hasMore = Boolean(res.data.pagination?.hasMore ?? entries.length === PAGE_SIZE);
  return { entries, hasMore };
}

function loadSavedState(): { scrollY: number; loadedCount: number } | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { scrollY?: number; loadedCount?: number };
    if (typeof parsed.loadedCount !== "number") {
      return null;
    }
    return {
      scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
      loadedCount: parsed.loadedCount,
    };
  } catch {
    return null;
  }
}

export function LiveGlobalLeaderboard({
  initial,
  initialHasMore = initial.length === PAGE_SIZE,
}: {
  initial: LeaderboardEntry[];
  initialHasMore?: boolean;
}) {
  const [entries, setEntries] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const prevRankByUserRef = useRef<Map<string, number>>(new Map());
  const [changedUsers, setChangedUsers] = useState<Set<string>>(new Set());
  const restoreOnceRef = useRef(false);

  const rows = useMemo(() => {
    return entries.map((entry) => {
      const userKey = entry.userId ?? entry.username;
      return { ...entry, _key: userKey };
    });
  }, [entries]);

  useEffect(() => {
    const saved = loadSavedState();
    if (restoreOnceRef.current || !saved) {
      return;
    }
    restoreOnceRef.current = true;

    let cancelled = false;

    const restore = async () => {
      setIsRestoring(true);
      let currentEntries = initial.slice();
      let nextOffset = currentEntries.length;

      while (currentEntries.length < saved.loadedCount) {
        const page = await fetchLeaderboardPage(nextOffset);
        if (cancelled || page.entries.length === 0) {
          break;
        }

        currentEntries = currentEntries.concat(page.entries);
        nextOffset = currentEntries.length;
        setEntries(currentEntries);
        setHasMore(page.hasMore);

        if (!page.hasMore) {
          break;
        }
      }

      if (!cancelled) {
        window.requestAnimationFrame(() => window.scrollTo(0, saved.scrollY));
        setIsRestoring(false);
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [initial]);

  useEffect(() => {
    const persistState = () => {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          scrollY: window.scrollY,
          loadedCount: entries.length,
        })
      );
    };

    window.addEventListener("pagehide", persistState);
    window.addEventListener("beforeunload", persistState);
    return () => {
      window.removeEventListener("pagehide", persistState);
      window.removeEventListener("beforeunload", persistState);
      persistState();
    };
  }, [entries.length]);

  useEffect(() => {
    const prev = prevRankByUserRef.current;
    const changed = new Set<string>();

    for (const row of rows) {
      const prevRank = prev.get(row._key);
      if (prevRank !== undefined && prevRank !== row.rank) {
        changed.add(row._key);
      }
      prev.set(row._key, row.rank);
    }

    if (changed.size === 0) {
      return;
    }

    setChangedUsers(changed);
    const timeout = window.setTimeout(() => setChangedUsers(new Set()), 600);
    return () => window.clearTimeout(timeout);
  }, [rows]);

  const loadMore = async () => {
    if (isLoadingMore || !hasMore) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await fetchLeaderboardPage(entries.length);
      if (page.entries.length === 0) {
        setHasMore(false);
        return;
      }

      setEntries((current) => current.concat(page.entries));
      setHasMore(page.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (rows.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="No games played yet"
          description="Be the first to climb the leaderboard."
          action={
            <Link href="/challenge">
              <Button>Browse Challenges</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isRestoring && (
        <div className="px-6 pt-4 text-sm text-[var(--muted-foreground)]">
          Restoring your place on the board...
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-6 py-3 text-left font-medium text-[var(--muted-foreground)]">Rank</th>
            <th className="px-6 py-3 text-left font-medium text-[var(--muted-foreground)]">Player</th>
            <th className="px-6 py-3 text-right font-medium text-[var(--muted-foreground)]">Score</th>
            <th className="px-6 py-3 text-right font-medium text-[var(--muted-foreground)]">Earned</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry) => (
            <tr
              key={entry._key}
              className={[
                "border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/50 transition-colors",
                changedUsers.has(entry._key) ? "bg-[var(--muted)]" : "",
              ].join(" ")}
            >
              <td className="px-6 py-4 font-bold">{MEDAL[entry.rank] ?? `#${entry.rank}`}</td>
              <td className="px-6 py-4">
                <div className="flex items-center gap-3">
                  {entry.avatarUrl ? (
                    <Image
                      src={entry.avatarUrl}
                      alt={entry.displayName ?? entry.username}
                      width={32}
                      height={32}
                      sizes="32px"
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--primary)] text-xs font-bold text-white">
                      {(entry.displayName ?? entry.username).charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="font-medium">{entry.displayName ?? entry.username}</span>
                  {entry.league && (
                    <Badge variant={entry.league as "gold" | "silver" | "bronze"}>
                      {entry.league}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-6 py-4 text-right font-mono">{formatScore(entry.totalScore)}</td>
              <td className="px-6 py-4 text-right font-medium text-green-600">
                {entry.totalEarned ? `${formatUsdc(entry.totalEarned)} USDC` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-4 px-6 pb-2">
        <p className="text-sm text-[var(--muted-foreground)]">
          Showing {rows.length} players
        </p>
        {hasMore ? (
          <Button variant="outline" onClick={() => void loadMore()} disabled={isLoadingMore}>
            {isLoadingMore ? "Loading..." : "Load more"}
          </Button>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">You&apos;re at the end.</p>
        )}
      </div>
    </div>
  );
}
