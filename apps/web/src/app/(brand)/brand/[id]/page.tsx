"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createApiClient } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsdc } from "@/lib/format";
import type { LeaderboardEntry } from "@/lib/api";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveChallengeLeaderboard } from "@/components/leaderboard/live-challenge-leaderboard";
import { toast } from "@/lib/toast";

interface DepositInfo {
  hotWalletAddress: string;
  memo: string;
  amount: string;
}

function normalizeBrand(brand: any) {
  if (!brand) return null;

  return {
    ...brand,
    logoUrl: brand.logoUrl ?? brand.logo_url ?? null,
    primaryColor: brand.primaryColor ?? brand.primary_color ?? null,
    secondaryColor: brand.secondaryColor ?? brand.secondary_color ?? null,
  };
}

function normalizeChallenge(challenge: any) {
  if (!challenge) return null;

  return {
    ...challenge,
    poolAmountUsdc: challenge.poolAmountUsdc ?? challenge.pool_amount_usdc ?? "0",
    participantCount: challenge.participantCount ?? challenge.participant_count ?? 0,
  };
}

export default function BrandAnalyticsPage() {
  const { data: session, status } = useSession();
  const params = useParams();
  const router = useRouter();
  const apiToken = (session as { apiToken?: string } | null)?.apiToken;
  const brandId = params.id as string;

  const [brand, setBrand] = useState<any>(null);
  const [challenge, setChallenge] = useState<any>(null);
  const [depositInfo, setDepositInfo] = useState<DepositInfo | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [brandLoadError, setBrandLoadError] = useState(false);
  const [challengeLoadError, setChallengeLoadError] = useState(false);
  const [leaderboardLoadError, setLeaderboardLoadError] = useState(false);

  async function loadAnalytics(apiToken: string) {
    setLoading(true);
    setBrandLoadError(false);
    setChallengeLoadError(false);
    setLeaderboardLoadError(false);

    const api = createApiClient(apiToken);
    const [brandResult, challengeResult] = await Promise.allSettled([
      api.get(`/brands/${brandId}`),
      api.get(`/challenges?brandId=${brandId}&limit=1`),
    ]);

    if (brandResult.status === "rejected") {
      setBrand(null);
      setChallenge(null);
      setLeaderboard([]);
      setBrandLoadError(true);
      setLoading(false);
      toast.error("Couldn't load brand details. Please try again.");
      return;
    }

    setBrand(normalizeBrand(brandResult.value.data.brand));

    if (challengeResult.status === "rejected") {
      setChallenge(null);
      setLeaderboard([]);
      setChallengeLoadError(true);
      setLoading(false);
      toast.error("Couldn't load challenges for this brand. Please try again.");
      return;
    }

    const latestChallenge = normalizeChallenge(challengeResult.value.data.challenges[0]);
    setChallenge(latestChallenge ?? null);

    // Fetch deposit info if challenge exists and is pending deposit
    if (latestChallenge && latestChallenge.status === "pending_deposit") {
      try {
        const depositRes = await api.get(`/challenges/${latestChallenge.id}/deposit-info`);
        setDepositInfo(depositRes.data.depositInfo);
      } catch (err) {
        // Silently fail if deposit info is not available
        setDepositInfo(null);
      }
    } else {
      setDepositInfo(null);
    }

    if (!latestChallenge) {
      setLeaderboard([]);
      setLoading(false);
      return;
    }

    try {
      const leaderboardResponse = await api.get(`/challenges/${latestChallenge.id}/leaderboard`);
      setLeaderboard(leaderboardResponse.data.sessions);
    } catch {
      setLeaderboard([]);
      setLeaderboardLoadError(true);
      toast.error("Couldn't load the challenge leaderboard. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
      return;
    }
    if (status !== "authenticated" || !apiToken) return;

    void loadAnalytics(apiToken);
  }, [apiToken, status, router, brandId]);

  if (loading) {
    return null;
  }

  if (!brand) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        {brandLoadError ? (
          <EmptyState
            title="Couldn't load brand"
            description="We couldn't load this brand — tap to retry."
            action={
              <Button disabled={!apiToken} onClick={() => apiToken && void loadAnalytics(apiToken)}>
                Try Again
              </Button>
            }
          />
        ) : (
          <p className="text-[var(--muted-foreground)]">Brand not found.</p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {brand.logoUrl ? (
            <Image
              src={brand.logoUrl}
              alt={brand.name}
              width={200}
              height={64}
              sizes="200px"
              className="h-16 w-auto object-contain"
            />
          ) : (
            <div
              className="h-16 w-16 rounded-xl"
              style={{ backgroundColor: brand.primaryColor ?? "var(--primary)" }}
            />
          )}
          <div>
            <h1 className="text-2xl font-bold">{brand.name}</h1>
            <p className="text-[var(--muted-foreground)]">{brand.tagline}</p>
          </div>
        </div>
        <Link href={`/brand/${brandId}/challenge/new`}>
          <Button>Launch New Challenge</Button>
        </Link>
      </div>

      {challenge && (
        <>
          {depositInfo ? (
            <Card className="mb-8 border-amber-300 bg-amber-50">
              <CardHeader>
                <CardTitle>Deposit Instructions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>Fund this challenge to activate it on-chain.</p>
                <div className="space-y-1 font-mono text-xs text-slate-700">
                  <p>Address: {depositInfo.hotWalletAddress}</p>
                  <p>Memo: {depositInfo.memo}</p>
                  {depositInfo.amount ? <p>Amount: {depositInfo.amount} USDC</p> : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="mb-8 grid grid-cols-3 gap-4">
            {[
              { label: "Pool Size", value: `${formatUsdc(challenge.poolAmountUsdc)} USDC` },
              { label: "Participants", value: challenge.participantCount ?? 0 },
              { label: "Status", value: challenge.status },
            ].map(({ label, value }) => (
              <Card key={label} className="text-center">
                <CardContent className="pb-4 pt-6">
                  <p className="text-xl font-bold text-[var(--primary)]">{value}</p>
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {leaderboardLoadError ? (
            <Card>
              <CardHeader>
                <CardTitle>Leaderboard unavailable</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState
                  title="Couldn't load leaderboard"
                  description="We couldn't load the latest rankings — tap to retry."
                  action={
                    <Button
                      disabled={!apiToken}
                      onClick={() => apiToken && void loadAnalytics(apiToken)}
                    >
                      Try Again
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : leaderboard.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Current Leaderboard</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <LiveChallengeLeaderboard
                  key={challenge.id}
                  challengeId={challenge.id}
                  initial={leaderboard}
                />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {!challenge &&
        (challengeLoadError ? (
          <EmptyState
            title="Couldn't load challenges"
            description="We couldn't load this brand's challenges — tap to retry."
            action={
              <Button disabled={!apiToken} onClick={() => apiToken && void loadAnalytics(apiToken)}>
                Try Again
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="This brand has no challenges yet"
            description="Launch your first challenge to start attracting players and tracking performance."
            action={
              <Link href={`/brand/${brandId}/challenge/new`}>
                <Button>Launch a Challenge</Button>
              </Link>
            }
          />
        ))}
    </main>
  );
}
