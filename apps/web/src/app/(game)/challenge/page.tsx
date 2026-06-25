"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatUsdc } from "@/lib/utils";
import { generateColoredBlurPlaceholder } from "@/lib/blur-placeholder";
import type { Challenge } from "@/lib/api";

const PAGE_SIZE = 20;

export default function ChallengeIndexPage() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const fetchPage = useCallback(async (pageOffset: number, replace: boolean) => {
    try {
      const res = await api.get(`/challenges?limit=${PAGE_SIZE}&offset=${pageOffset}`);
      const page: Challenge[] = res.data.challenges;
      setChallenges((prev) => replace ? page : [...prev, ...page]);
      setHasMore(page.length === PAGE_SIZE);
      setOffset(pageOffset + page.length);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  // Initial load — render only the first 20 cards into the DOM (#362).
  useEffect(() => {
    void fetchPage(0, true).finally(() => setLoading(false));
  }, [fetchPage]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await fetchPage(offset, false);
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold">Active Challenges</h1>
        <p className="mb-8 text-[var(--muted-foreground)]">
          Pick a challenge, study the brand, and earn USDC
        </p>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-12 w-32 rounded bg-[var(--muted)] mb-2" />
                <div className="h-5 w-40 rounded bg-[var(--muted)]" />
              </CardHeader>
              <CardContent>
                <div className="h-10 w-full rounded bg-[var(--muted)]" />
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">Active Challenges</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">
        Pick a challenge, study the brand, and earn USDC
      </p>

      {failed && challenges.length === 0 ? (
        <p className="text-[var(--muted-foreground)]">
          Couldn&apos;t load active challenges right now. Refresh and try again.
        </p>
      ) : challenges.length === 0 ? (
        <p className="text-[var(--muted-foreground)]">No active challenges yet. Check back soon!</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {challenges.map((c, index) => (
              <Card key={c.id} className="transition-shadow hover:shadow-lg">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    {c.logo_url ? (
                      <Image
                        src={c.logo_url}
                        alt={c.brand_name ?? "Brand logo"}
                        width={160}
                        height={48}
                        sizes="160px"
                        className="h-12 w-auto object-contain"
                        loading={index < 3 ? "eager" : "lazy"}
                        placeholder="blur"
                        blurDataURL={generateColoredBlurPlaceholder(c.primary_color)}
                        priority={index < 3}
                      />
                    ) : (
                      <div
                        className="h-12 w-12 rounded-lg"
                        style={{ backgroundColor: c.primary_color ?? "var(--primary)" }}
                      />
                    )}
                    <Badge variant="default">Active</Badge>
                  </div>
                  <CardTitle>{c.brand_name ?? "Untitled brand"}</CardTitle>
                  <CardDescription>Prize pool: {formatUsdc(c.pool_amount_usdc)} USDC</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link href={`/challenge/${c.id}`}>
                    <Button
                      className="w-full"
                      style={{ backgroundColor: c.primary_color ?? undefined }}
                    >
                      Accept Challenge
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          {hasMore && (
            <div className="mt-10 flex justify-center">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more challenges"}
              </Button>
            </div>
          )}

          {failed && challenges.length > 0 && (
            <p className="mt-6 text-center text-sm text-[var(--muted-foreground)]">
              Couldn&apos;t load more challenges. Try again.
            </p>
          )}
        </>
      )}
    </main>
  );
}
