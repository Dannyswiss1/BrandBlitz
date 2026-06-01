"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createApiClient, type Challenge, type ChallengeQuestion } from "@/lib/api";
import { TOTAL_ROUNDS } from "@/components/game/constants";

const WarmupPhase = dynamic(() => import("@/components/game/warmup-phase").then((m) => m.WarmupPhase), {
  loading: () => <div className="min-h-screen flex items-center justify-center">Loading warmup...</div>,
});

const ChallengeRound = dynamic(() => import("@/components/game/challenge-round").then((m) => m.ChallengeRound), {
  loading: () => <div className="min-h-screen flex items-center justify-center">Loading round...</div>,
});

const ResultScreen = dynamic(() => import("@/components/game/result-screen").then((m) => m.ResultScreen), {
  loading: () => <div className="min-h-screen flex items-center justify-center">Preparing results...</div>,
});

type GamePhase = "loading" | "warmup" | "challenge" | "result";

interface Props {
  params: Promise<{ id: string }>;
}

export function ChallengePage({ params }: Props) {
  const { id: challengeId } = React.use(params);
  const { data: session, status } = useSession();
  const router = useRouter();

  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const [questions, setQuestions] = React.useState<ChallengeQuestion[]>([]);
  const [phase, setPhase] = React.useState<GamePhase>("loading");
  const [currentRound, setCurrentRound] = React.useState<1 | 2 | 3>(1);
  const [challengeToken, setChallengeToken] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  const [scores, setScores] = React.useState<number[]>([]);

  React.useEffect(() => {
    if (!challengeId) return;
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=/challenge/${challengeId}`);
      return;
    }
    if (status !== "authenticated") return;

    const apiToken = (session as any).apiToken as string;
    const api = createApiClient(apiToken);

    api.get(`/challenges/${challengeId}`).then((res) => {
      setChallenge(res.data.challenge);
      setQuestions(res.data.questions);
      api.post(`/sessions/${challengeId}/warmup-start`, { deviceId: undefined }).then((r) => {
        setSessionId(r.data.sessionId);
        setPhase("warmup");
      });
    });
  }, [challengeId, session, status, router]);

  const handleWarmupComplete = (token: string) => {
    setChallengeToken(token);
    setPhase("challenge");
    setCurrentRound(1);
  };

  const handleAnswer = async (option: "A" | "B" | "C" | "D" | null, reactionTimeMs: number) => {
    const apiToken = (session as any)?.apiToken as string;
    const api = createApiClient(apiToken);
    const res = await api.post(`/sessions/${challengeId}/answer/${currentRound}`, { selectedOption: option, reactionTimeMs });
    setScores((prev) => [...prev, res.data.score]);
    if (currentRound < TOTAL_ROUNDS) {
      setCurrentRound((r) => (r + 1) as 1 | 2 | 3);
    } else {
      setPhase("result");
    }
  };

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">Loading challenge...</div>
      </div>
    );
  }
  if (phase === "warmup" && challenge) {
    return (
      <WarmupPhase
        challenge={challenge}
        apiToken={(session as any).apiToken as string}
        onComplete={handleWarmupComplete}
      />
    );
  }
  if (phase === "challenge" && challenge) {
    const question = questions[currentRound - 1];
    if (!question) return null;
    return (
      <div className="min-h-screen p-6">
        <ChallengeRound question={question} round={currentRound} onAnswer={handleAnswer} brandLogoUrl={challenge.logo_url ?? undefined} />
      </div>
    );
  }
  if (phase === "result") {
    return <ResultScreen totalScore={scores.reduce((a, b) => a + b, 0)} challengeId={challengeId} />;
  }
  return null;
}
