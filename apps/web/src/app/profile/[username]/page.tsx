import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatScore, formatUsdc, safeDivide } from "@/lib/format";
import { StreakBadge } from "@/components/gamification/streak-badge";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";
import type { UserProfile } from "@/lib/api";
import {
  BadgeGrid,
  type Badge as UserBadge,
} from "@/components/gamification/badge-grid";
import { OfflineBanner } from "@/components/layout/offline-banner";
import type { Metadata } from "next";

interface ProfilePageProps {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
  const { username } = await params;
  const { user, redirect: redirectTarget } = await getUserProfile(username);

  if (redirectTarget) {
    return { title: "Redirecting…" };
  }

  if (!user) {
    return {
      title: "Profile Not Found",
    };
  }

  const title = `${user.displayName} (@${user.username}) — Profile`;
  const description = `Check out ${user.displayName}'s profile on BrandBlitz. They have earned ${formatUsdc(user.totalEarned ?? "0")} USDC across ${user.totalChallenges ?? 0} challenges.`;

  return {
    title,
    description,
    alternates: {
      canonical: `/profile/${username}`,
    },
    openGraph: {
      title,
      description,
      images: user.avatarUrl ? [{ url: user.avatarUrl, alt: user.displayName }] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: user.avatarUrl ? [user.avatarUrl] : undefined,
    },
  };
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api";

async function getUserProfile(
  username: string,
): Promise<{ user: UserProfile | null; failed: boolean; redirect?: string }> {
  try {
    const res = await fetch(`${API_URL}/users/profile/${username}`, {
      next: { tags: [`profile-${username}`] },
    });
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    if (data.redirect) {
      return { user: null, failed: false, redirect: data.redirect };
    }
    return { user: data.user, failed: false };
  } catch {
    return { user: null, failed: true };
  }
}

async function getUserBadges(userId: string): Promise<UserBadge[]> {
  try {
    const res = await fetch(`${API_URL}/users/${userId}/badges`);
    if (!res.ok) throw new Error("Failed to fetch");
    const data = await res.json();
    return data.badges ?? [];
  } catch {
    return [];
  }
}

export default async function ProfilePage({ params }: ProfilePageProps) {
  const { username } = await params;
  if (!username?.trim()) notFound();
  const { user, failed, redirect: redirectTarget } = await getUserProfile(username);

  if (redirectTarget) {
    redirect(`/profile/${redirectTarget}`);
  }

  if (!user && failed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <EmptyState
          title="Couldn't load profile"
          description="We couldn't load this profile right now. Please try again."
          action={
            <Link href={`/profile/${username}`}>
              <Button variant="outline">Try Again</Button>
            </Link>
          }
        />
      </main>
    );
  }

  if (!user) notFound();

  const badges = user.userId ? await getUserBadges(user.userId) : [];
  const earnedIds = badges.filter((b) => b.earned).map((b) => b.id);

  const streak = user.streak ?? 0;
  const recentSessions = user.recentSessions ?? [];
  const milestones = [3, 7, 14, 30];
  const nextMilestone =
    milestones.find((m) => m > streak) ?? milestones[milestones.length - 1];
  const progress = Math.min(1, safeDivide(streak, nextMilestone, 0));

  return (
    <>
      <OfflineBanner />
      <main className="mx-auto max-w-2xl px-6 py-12">
      {/* Profile header */}
      <div className="mb-10 flex items-center gap-6">
        {user.avatarUrl ? (
          <Image
            src={user.avatarUrl}
            alt={user.displayName}
            width={80}
            height={80}
            sizes="80px"
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--primary)] text-2xl font-bold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold">{user.displayName}</h1>
          <p className="text-[var(--muted-foreground)]">@{user.username}</p>
          {user.league && (
            <Badge variant={user.league} className="mt-2">
              {user.league} League
            </Badge>
          )}
        </div>
      </div>

      {streak > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Streak Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-[var(--muted-foreground)]">
                  Current streak
                </p>
                <p className="text-3xl font-bold text-[var(--primary)]">
                  {streak} days
                </p>
              </div>
              <StreakBadge streak={streak} label="Current streak" />
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-orange-400 to-red-500"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              Next milestone: {nextMilestone} days ({Math.round(progress * 100)}
              %)
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        {[
          { label: "Challenges", value: user.totalChallenges ?? 0 },
          { label: "Best Score", value: formatScore(user.bestScore ?? 0) },
          {
            label: "USDC Earned",
            value: `${formatUsdc(user.totalEarned ?? "0")}`,
          },
        ].map(({ label, value }) => (
          <Card key={label} className="text-center">
            <CardContent className="pb-4 pt-6">
              <p className="text-2xl font-bold text-[var(--primary)]">
                {value}
              </p>
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {label}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Badges</CardTitle>
          </CardHeader>
          <CardContent>
            <BadgeGrid badges={badges} previouslyEarned={earnedIds} />
          </CardContent>
        </Card>
      )}

      {/* Recent activity */}
      {recentSessions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent Challenges</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {recentSessions.map((session) => (
                  <tr
                    key={session.id}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-6 py-3 font-medium">
                      {session.brandName}
                    </td>
                    <td className="px-6 py-3 text-right">
                      {formatScore(session.totalScore)}
                    </td>
                    <td className="px-6 py-3 text-right text-[var(--muted-foreground)]">
                      {session.rank ? `#${session.rank}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title="No history yet"
          description="Play a challenge to start building your stats."
          action={
            <Link href="/challenge">
              <Button>Browse Challenges</Button>
            </Link>
          }
        />
      )}
      </main>
    </>
  );
}
