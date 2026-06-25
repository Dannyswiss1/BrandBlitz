"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createApiClient, type Challenge, type ChallengeQuestion } from "@/lib/api";
import { useFingerprint } from "@/hooks/use-fingerprint";
import { useSoundEffects } from "@/hooks/use-sound-effects";
import { SoundToggle } from "@/components/layout/sound-toggle";
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
  const visitorId = useFingerprint();
  const { enabled: soundsEnabled, toggle: toggleSounds, correct: playCorrect, wrong: playWrong, tick: playTick } = useSoundEffects();

  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const [questions, setQuestions] = React.useState<ChallengeQuestion[]>([]);
  const [phase, setPhase] = React.useState<GamePhase>("loading");
  const [currentRound, setCurrentRound] = React.useState<1 | 2 | 3>(1);
  const [challengeToken, setChallengeToken] = React.useState("");
  const [sessionId, setSessionId] = React.useState("");
  const [scores, setScores] = React.useState<number[]>([]);
  const [finalRank, setFinalRank] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!challengeId) return;
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=/challenge/${challengeId}`);
      return;
    }
    if (status !== "authenticated") return;

    const apiToken = (session as any).apiToken as string;
    const api = createApiClient(apiToken);

    void (async () => {
      try {
        const res = await api.get(`/challenges/${challengeId}`);
        setChallenge(res.data.challenge);
        setQuestions(res.data.questions);
      } catch {
        setLoadError("Couldn't load the challenge. Check your connection and try again.");
        return;
      }

      try {
        // Send visitorId (FingerprintJS) as deviceId for anti-cheat multi-account detection.
        // If FingerprintJS fails to load, visitorId will be null and backend will flag for review.
        const r = await api.post(`/sessions/${challengeId}/warmup-start`, { deviceId: visitorId });
        setSessionId(r.data.sessionId);
        setPhase("warmup");
      } catch {
        setLoadError("Couldn't start the game session. Please try again.");
      }
    })();
  }, [challengeId, session, status, router, visitorId]);

  const handleWarmupComplete = (token: string) => {
    setChallengeToken(token);
    setPhase("challenge");
    setCurrentRound(1);
  };

  const handleAnswer = async (option: "A" | "B" | "C" | "D" | null, reactionTimeMs: number) => {
  // #154 — answer submission must surface errors instead of silently
  // advancing. Strategy: retry with backoff a few times for transient
  // failures, then surface an inline banner with a Retry button so
  // the player can re-attempt without losing the round. We stash the
  // last attempted answer in state so Retry replays the same payload.
  const [answerError, setAnswerError] = React.useState<string | null>(null);
  const lastAnswerRef = React.useRef<{ option: "A" | "B" | "C" | "D"; reactionTimeMs: number } | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const ANSWER_MAX_ATTEMPTS = 3;
  const ANSWER_RETRY_DELAY_MS = 500;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const submitAnswer = async (option: "A" | "B" | "C" | "D", reactionTimeMs: number, signal: AbortSignal) => {
    const apiToken = (session as any)?.apiToken as string;
    const api = createApiClient(apiToken);
    let lastError: unknown;
    for (let attempt = 0; attempt < ANSWER_MAX_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error("Aborted");
      try {
        const res = await api.post(
          `/sessions/${challengeId}/answer/${currentRound}`,
          { selectedOption: option, reactionTimeMs },
          { signal }
        );
        return {
          score: res.data.score as number,
          rank: (res.data.rank as number | null) ?? null,
        };
      } catch (err: any) {
        if (err.name === "CanceledError" || err.message === "Aborted") {
          throw err;
        }
        lastError = err;
        if (attempt < ANSWER_MAX_ATTEMPTS - 1) {
          await sleep(ANSWER_RETRY_DELAY_MS);
        }
      }
    }
    throw lastError;
  };

  const handleAnswer = async (option: "A" | "B" | "C" | "D", reactionTimeMs: number) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    lastAnswerRef.current = { option, reactionTimeMs };
    setAnswerError(null);
    try {
      const result = await submitAnswer(option, reactionTimeMs, abortController.signal);
      if (!mountedRef.current) return;
      if (result.score > 0) {
        playCorrect();
      } else {
        playWrong();
      }
      setScores((prev) => [...prev, result.score]);
      if (result.rank !== null) {
        setFinalRank(result.rank);
      }
      // Advance ONLY after the server confirms the round was scored.
      // Without this guarantee the `scores` array drifts out of sync
      // with the server's view of the session.
      if (currentRound < TOTAL_ROUNDS) {
        setCurrentRound((r) => (r + 1) as 1 | 2 | 3);
      } else {
        setPhase("result");
      }
    } catch (err: any) {
      if (!mountedRef.current || err.name === "CanceledError" || err.message === "Aborted") return;
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

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-medium text-[var(--foreground)]">{loadError}</p>
        <button
          className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
          onClick={() => { setLoadError(null); router.refresh(); }}
        >
          Try again
        </button>
      </div>
    );
  }

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
        <div className="flex justify-end mb-4">
          <SoundToggle enabled={soundsEnabled} onToggle={toggleSounds} />
        </div>
        <ChallengeRound
          question={question}
          round={currentRound}
          onAnswer={handleAnswer}
          brandLogoUrl={challenge.logo_url ?? undefined}
          answerError={answerError}
          onRetry={retryLastAnswer}
          onTick={playTick}
        />
      </div>
    );
  }
  if (phase === "result") {
    return (
      <ResultScreen
        totalScore={scores.reduce((a, b) => a + b, 0)}
        challengeId={challengeId}
        rank={finalRank ?? undefined}
        primaryColor={challenge?.primary_color ?? undefined}
        secondaryColor={challenge?.secondary_color ?? undefined}
      />
    );
  }
  return null;
}
