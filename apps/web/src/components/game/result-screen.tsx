"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatScore, formatUsdc } from "@/lib/format";

interface ResultScreenProps {
  totalScore: number;
  rank?: number;
  estimatedUsdc?: string;
  challengeId: string;
}

export function ResultScreen({ totalScore, rank, estimatedUsdc, challengeId }: ResultScreenProps) {
  const [shareToast, setShareToast] = useState<string | null>(null);
  const shareText = `I just scored ${formatScore(totalScore)} in a BrandBlitz challenge${estimatedUsdc ? ` and earned ~${formatUsdc(estimatedUsdc)} USDC` : ""}! 🏆`;
  const leaderboardHref = `/challenge/${challengeId}`;

  async function handleShare(): Promise<void> {
    if (navigator.share) {
      await navigator.share({ text: shareText, url: window.location.href });
      return;
    }

    await navigator.clipboard.writeText(shareText);
    setShareToast("Result copied to clipboard.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-sm w-full text-center">
        <CardHeader>
          <CardTitle className="text-2xl">Challenge Complete!</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-6xl font-bold text-[var(--primary)]">{formatScore(totalScore)}</p>
            <p className="text-[var(--muted-foreground)] mt-1">points</p>
          </div>

          {rank && (
            <p className="text-lg font-medium">
              Rank #{rank}
            </p>
          )}

          {estimatedUsdc && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4">
              <p className="text-sm text-green-700">Estimated earnings</p>
              <p className="text-2xl font-bold text-green-800">{formatUsdc(estimatedUsdc)} USDC</p>
              <p className="text-xs text-green-600 mt-1">Paid out when challenge ends</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => {
                void handleShare();
              }}
              variant="outline"
              className="w-full"
            >
              Share Result
            </Button>

            <Button asChild variant="secondary" className="w-full">
              <Link href={leaderboardHref}>
                View Leaderboard
              </Link>
            </Button>

            <Button asChild className="w-full">
              <Link href="/">Play Another Challenge</Link>
            </Button>
          </div>

          {shareToast ? (
            <p role="status" aria-live="polite" className="text-sm font-medium text-green-700">
              {shareToast}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
