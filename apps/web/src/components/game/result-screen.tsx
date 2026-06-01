"use client";

import { useState, useEffect, useRef } from "react";
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

const COUNTER_DURATION_MS = 1200;

const CONFETTI_COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6",
  "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

function useAnimatedValue(target: number, durationMs: number): number {
  const [value, setValue] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    startTimeRef.current = null;

    function easeOutCubic(t: number): number {
      return 1 - Math.pow(1 - t, 3);
    }

    function step(timestamp: number) {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / durationMs, 1);
      const easedProgress = easeOutCubic(progress);
      setValue(Math.round(easedProgress * target));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, durationMs]);

  return value;
}

function useConfetti(show: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!show || typeof window === "undefined") return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.inset = "0";
    container.style.pointerEvents = "none";
    container.style.zIndex = "9999";
    document.body.appendChild(container);
    containerRef.current = container;

    const pieces = Array.from({ length: 60 }, (_, i) => {
      const piece = document.createElement("div");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.top = "-10px";
      piece.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.width = `${6 + Math.random() * 8}px`;
      piece.style.height = `${6 + Math.random() * 8}px`;
      piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      piece.style.animationDelay = `${Math.random() * 1.5}s`;
      piece.style.animationDuration = `${2 + Math.random() * 2}s`;
      return piece;
    });

    pieces.forEach((p) => container.appendChild(p));

    return () => {
      container.remove();
      containerRef.current = null;
    };
  }, [show]);
}

export function ResultScreen({ totalScore, rank, estimatedUsdc, challengeId }: ResultScreenProps) {
  const [shareToast, setShareToast] = useState<string | null>(null);
  const animatedScore = useAnimatedValue(totalScore, COUNTER_DURATION_MS);
  const showConfetti = rank !== undefined && rank <= 10;
  useConfetti(showConfetti);

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
            <p className="text-6xl font-bold text-[var(--primary)]">{formatScore(animatedScore)}</p>
            <p className="text-[var(--muted-foreground)] mt-1">points</p>
          </div>

          {rank && (
            <p className="text-lg font-medium">
              Rank #{rank}
            </p>
          )}

          {estimatedUsdc && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 usdc-pulse">
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
