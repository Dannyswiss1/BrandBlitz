"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { WarmupPhase } from "@/components/game/warmup-phase";
import { ChallengeRound } from "@/components/game/challenge-round";
import { ResultScreen } from "@/components/game/result-screen";
import { createApiClient, type Challenge, type ChallengeQuestion } from "@/lib/api";
import { useFingerprint } from "@/hooks/use-fingerprint";
import { TOTAL_ROUNDS } from "@/components/game/constants";

type GamePhase = "loading" | "warmup" | "challenge" | "result";

interface Props {
  params: Promise<{ id: string }>;
}

export function ChallengePage({ params }: Props) {
  const { id: challengeId } = React.use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const visitorId = useFingerprint();

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
      // Send visitorId (FingerprintJS) as deviceId for anti-cheat multi-account detection
      // If FingerprintJS fails to load, visitorId will be null and backend will flag for review
      api.post(`/sessions/${challengeId}/warmup-start`, { deviceId: visitorId }).then((r) => {
        setSessionId(r.data.sessionId);
        setPhase("warmup");
      });
    });
  }, [challengeId, session, status, router, visitorId]);

  const handleWarmupComplete = (token: string) => {
    setChallengeToken(token);
    setPhase("challenge");
    setCurrentRound(1);
  };

  // #154 — answer submission must surface errors instead of silently
  // advancing. Strategy: retry with backoff a few times for transient
  // failures, then surface an inline banner with a Retry button so
  // the player can re-attempt without losing the round. We stash the
  // last attempted answer in state so Retry replays the same payload.
  const [answerError, setAnswerError] = React.useState<string | null>(null);
  const lastAnswerRef = React.useRef<{ option: "A" | "B" | "C" | "D"; reactionTimeMs: number } | null>(null);

  const ANSWER_MAX_ATTEMPTS = 3;
  const ANSWER_RETRY_DELAY_MS = 500;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const submitAnswer = async (option: "A" | "B" | "C" | "D", reactionTimeMs: number) => {
    const apiToken = (session as any)?.apiToken as string;
    const api = createApiClient(apiToken);
    let lastError: unknown;
    for (let attempt = 0; attempt < ANSWER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await api.post(
          `/sessions/${challengeId}/answer/${currentRound}`,
          { selectedOption: option, reactionTimeMs },
        );
        return res.data.score as number;
      } catch (err) {
        lastError = err;
        if (attempt < ANSWER_MAX_ATTEMPTS - 1) {
          await sleep(ANSWER_RETRY_DELAY_MS);
        }
      }
    }
    throw lastError;
  };

  const handleAnswer = async (option: "A" | "B" | "C" | "D", reactionTimeMs: number) => {
    lastAnswerRef.current = { option, reactionTimeMs };
    setAnswerError(null);
    try {
      const score = await submitAnswer(option, reactionTimeMs);
      setScores((prev) => [...prev, score]);
      // Advance ONLY after the server confirms the round was scored.
      // Without this guarantee the `scores` array drifts out of sync
      // with the server's view of the session.
      if (currentRound < TOTAL_ROUNDS) {
        setCurrentRound((r) => (r + 1) as 1 | 2 | 3);
      } else {
        setPhase("result");
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        err?.message ??
        "Failed to submit answer. Check your connection and try again.";
      setAnswerError(message);
    }
  };

  const retryLastAnswer = () => {
    const last = lastAnswerRef.current;
    if (!last) return;
    void handleAnswer(last.option, last.reactionTimeMs);
  };

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">Loading challenge...</div>
      </div>
    );
  }
  // #151 — `WarmupPhase` needs apiToken so it can call the
  // authenticated API client instead of falling back to a missing
  // /api/proxy/* route. Lifting apiToken into this render scope
  // (rather than re-reading from session inside the child) keeps
  // the auth context centralised.
  const apiToken = (session as any)?.apiToken as string | undefined;
  if (phase === "warmup" && challenge && apiToken) {
    return (
      <WarmupPhase
        challenge={challenge}
        apiToken={apiToken}
        onComplete={handleWarmupComplete}
      />
    );
  }
  if (phase === "challenge" && challenge) {
    const question = questions[currentRound - 1];
    if (!question) return null;
    return (
      <div className="min-h-screen p-6">
        <ChallengeRound
          question={question}
          round={currentRound}
          onAnswer={handleAnswer}
          brandLogoUrl={challenge.logo_url ?? undefined}
          answerError={answerError}
          onRetry={retryLastAnswer}
        />
      </div>
    );
  }
  if (phase === "result") {
    return <ResultScreen totalScore={scores.reduce((a, b) => a + b, 0)} challengeId={challengeId} />;
  }
  return null;
}
