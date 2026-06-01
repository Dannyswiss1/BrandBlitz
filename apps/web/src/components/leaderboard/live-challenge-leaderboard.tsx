"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatScore } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/api";
import { useLiveLeaderboard } from "@/hooks/use-live-leaderboard";

export function LiveChallengeLeaderboard({
  challengeId,
  initial,
}: {
  challengeId: string;
  initial: LeaderboardEntry[];
}) {
  const { entries } = useLiveLeaderboard({ challengeId, initial });
  const prevRankByUserRef = useRef<Map<string, number>>(new Map());
  const [changedUsers, setChangedUsers] = useState<Set<string>>(new Set());

  const rows = useMemo(() => {
    return entries.slice(0, 10).map((e) => {
      const userKey = e.userId ?? e.username;
      return { ...e, _key: userKey };
    });
  }, [entries]);

  useEffect(() => {
    const prev = prevRankByUserRef.current;
    const changed = new Set<string>();
    for (const row of rows) {
      const prevRank = prev.get(row._key);
      if (prevRank !== undefined && prevRank !== row.rank) changed.add(row._key);
      prev.set(row._key, row.rank);
    }
    if (changed.size === 0) return;
    setChangedUsers(changed);
    const t = window.setTimeout(() => setChangedUsers(new Set()), 600);
    return () => window.clearTimeout(t);
  }, [rows]);

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--border)]">
          <th className="text-left px-6 py-3 text-[var(--muted-foreground)]">Rank</th>
          <th className="text-left px-6 py-3 text-[var(--muted-foreground)]">Player</th>
          <th className="text-right px-6 py-3 text-[var(--muted-foreground)]">Score</th>
          <th className="text-right px-6 py-3 text-[var(--muted-foreground)]">Est. Payout</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => (
          <tr
            key={entry._key}
            className={[
              "border-b border-[var(--border)] last:border-0 transition-colors",
              changedUsers.has(entry._key) ? "bg-[var(--muted)]" : "",
            ].join(" ")}
          >
            <td className="px-6 py-3 font-bold">#{entry.rank}</td>
            <td className="px-6 py-3">{entry.displayName ?? entry.username}</td>
            <td className="px-6 py-3 text-right font-mono">{formatScore(entry.totalScore)}</td>
            <td className="px-6 py-3 text-right text-green-600">{"—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

