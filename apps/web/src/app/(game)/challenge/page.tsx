import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { formatUsdc } from "@/lib/utils";
import type { Challenge } from "@/lib/api";

async function getActiveChallenges(): Promise<{ challenges: Challenge[]; failed: boolean }> {
  try {
    const res = await api.get("/challenges?limit=20");
    return {
      challenges: res.data.challenges,
      failed: false,
    };
  } catch {
    return {
      challenges: [],
      failed: true,
    };
  }
}

export default async function ChallengeIndexPage() {
  const { challenges, failed } = await getActiveChallenges();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="mb-2 text-3xl font-bold">Active Challenges</h1>
      <p className="mb-8 text-[var(--muted-foreground)]">
        Pick a challenge, study the brand, and earn USDC
      </p>

      {failed ? (
        <p className="text-[var(--muted-foreground)]">
          Couldn&apos;t load active challenges right now. Refresh and try again.
        </p>
      ) : challenges.length === 0 ? (
        <p className="text-[var(--muted-foreground)]">No active challenges yet. Check back soon!</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {challenges.map((c) => (
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
      )}
    </main>
  );
}
