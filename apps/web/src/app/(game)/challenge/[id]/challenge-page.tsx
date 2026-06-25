"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createApiClient, type Challenge, type ChallengeQuestion } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useFingerprint } from "@/hooks/use-fingerprint";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { TOTAL_ROUNDS } from "@/components/game/constants";
import type { AnswerOptionKey } from "@/components/game/answer-option";
import type { ChallengeAnswerState } from "@/components/game/challenge-round";
import { OfflineBanner } from "@/components/layout/offline-banner";
import {
  SessionRecoveryModal,
  type SessionRecoveryDetails,
} from "@/components/game/session-recovery-modal";
import { scoresForResume, shouldShowRecoveryModal } from "@/components/game/session-recovery";

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

interface RecoverySessionResponse {
  id: string;
  status: "warmup" | "in_progress" | "completed" | "expired";
  last_answered_round: number;
  current_round: number;
  remaining_time_ms: number;
  total_score: number;
  round_scores?: number[];
}

const ANSWER_MAX_ATTEMPTS = 3;
const ANSWER_RETRY_DELAY_MS = 500;
const ANSWER_SETTLED_DELAY_MS = 450;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function errorMessage(err: any): string {
  return (
    err?.response?.data?.message ??
    err?.response?.data?.error ??
    err?.message ??
    "Failed to submit answer. Check your connection and try again."
  );
}

function toRecoveryDetails(session: RecoverySessionResponse): SessionRecoveryDetails {
  return {
    status: session.status === "expired" ? "expired" : "in_progress",
    currentRound: session.current_round,
    remainingTimeMs: session.remaining_time_ms,
    totalScore: session.total_score,
  };
}

export function ChallengePage({ params }: Props) {
  const { id: challengeId } = React.use(params);
  const { data: session, status } = useSession();
  const router = useRouter();
  const visitorId = useFingerprint();
  const { isOnline } = useNetworkStatus();

  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const [questions, setQuestions] = React.useState<ChallengeQuestion[]>([]);
  const [phase, setPhase] = React.useState<GamePhase>("loading");
  const [currentRound, setCurrentRound] = React.useState<1 | 2 | 3>(1);
  const [scores, setScores] = React.useState<number[]>([]);
  const [finalRank, setFinalRank] = React.useState<number | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [answerError, setAnswerError] = React.useState<string | null>(null);
  const [answerState, setAnswerState] = React.useState<ChallengeAnswerState | null>(null);
  const [recoverySession, setRecoverySession] = React.useState<RecoverySessionResponse | null>(null);

  const mountedRef = React.useRef(true);
  const currentRoundRef = React.useRef(currentRound);
  const answerStateRef = React.useRef(answerState);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const lastAnswerRef = React.useRef<{ option: AnswerOptionKey | null; reactionTimeMs: number } | null>(null);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    currentRoundRef.current = currentRound;
  }, [currentRound]);

  React.useEffect(() => {
    answerStateRef.current = answerState;
  }, [answerState]);

  const apiToken = (session as any)?.apiToken as string | undefined;

  const clearOpenSession = React.useCallback(async () => {
    if (!apiToken) return;
    const api = createApiClient(apiToken);
    await api.delete(`/sessions/${challengeId}`, { skipErrorToast: true });
  }, [apiToken, challengeId]);

  React.useEffect(() => {
    if (!challengeId) return;
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=/challenge/${challengeId}`);
      return;
    }
    if (status !== "authenticated" || !apiToken) return;

    const api = createApiClient(apiToken);
    let cancelled = false;

    void (async () => {
      setPhase("loading");
      setLoadError(null);
      setRecoverySession(null);

      try {
        const res = await api.get(`/challenges/${challengeId}`);
        if (cancelled) return;
        setChallenge(res.data.challenge);
        setQuestions(res.data.questions);
      } catch {
        if (!cancelled) setLoadError("Couldn't load the challenge. Check your connection and try again.");
        return;
      }

      try {
        const res = await api.get(`/sessions/${challengeId}`, { skipErrorToast: true });
        const existing = res.data.session as RecoverySessionResponse;
        if (cancelled) return;

        if (shouldShowRecoveryModal(existing)) {
          setRecoverySession(existing);
          return;
        }
      } catch (err: any) {
        if (err?.response?.status && err.response.status !== 404) {
          if (!cancelled) setLoadError("Couldn't check your session status. Please try again.");
          return;
        }
      }

      if (!cancelled) setPhase("warmup");
    })();

    return () => {
      cancelled = true;
    };
  }, [apiToken, challengeId, router, status]);

  const handleWarmupComplete = async (challengeToken: string) => {
    if (!apiToken) return;
    const api = createApiClient(apiToken);

    try {
      await api.post(`/sessions/${challengeId}/start`, { challengeToken });
      setScores([]);
      setAnswerError(null);
      setAnswerState(null);
      setCurrentRound(1);
      setPhase("challenge");
    } catch {
      setLoadError("Couldn't start the challenge. Please try again.");
    }
  };

  const submitAnswer = async (
    option: AnswerOptionKey | null,
    reactionTimeMs: number,
    signal: AbortSignal,
  ): Promise<{ score: number; correct: boolean }> => {
    if (!apiToken) throw new Error("Missing API token");
    const api = createApiClient(apiToken);
    let lastError: unknown;

    for (let attempt = 0; attempt < ANSWER_MAX_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error("Aborted");
      try {
        const res = await api.post(
          `/sessions/${challengeId}/answer/${currentRoundRef.current}`,
          { selectedOption: option, reactionTimeMs },
          { signal, skipErrorToast: true },
        );
        return { score: res.data.score as number, correct: Boolean(res.data.correct) };
      } catch (err: any) {
        if (err.name === "CanceledError" || err.message === "Aborted") throw err;
        lastError = err;
        if (attempt < ANSWER_MAX_ATTEMPTS - 1) {
          await sleep(ANSWER_RETRY_DELAY_MS);
        }
      }
    }

    throw lastError;
  };

  const handleAnswer = async (option: AnswerOptionKey | null, reactionTimeMs: number) => {
    if (!isOnline) {
      toast.error("You are offline. Reconnect before submitting an answer.");
      return;
    }
    if (answerStateRef.current?.status === "pending") return;

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    lastAnswerRef.current = { option, reactionTimeMs };

    setAnswerError(null);
    setAnswerState({ selectedOption: option, status: "pending", correct: null });

    try {
      const result = await submitAnswer(option, reactionTimeMs, abortController.signal);
      if (!mountedRef.current) return;

      setAnswerState({ selectedOption: option, status: "settled", correct: result.correct });
      setScores((prev) => [...prev, result.score]);
      await sleep(ANSWER_SETTLED_DELAY_MS);
      if (!mountedRef.current || abortController.signal.aborted) return;

      setAnswerState(null);
      if (currentRoundRef.current < TOTAL_ROUNDS) {
        setCurrentRound((round) => (round + 1) as 1 | 2 | 3);
      } else {
        setPhase("result");
      }
    } catch (err: any) {
      if (!mountedRef.current || err.name === "CanceledError" || err.message === "Aborted") return;
      const message = errorMessage(err);
      setAnswerState(null);
      setAnswerError(message);
      toast.error(message);
    }
  };

  const retryLastAnswer = () => {
    const last = lastAnswerRef.current;
    if (!last) return;
    void handleAnswer(last.option, last.reactionTimeMs);
  };

  const handleResume = () => {
    if (!recoverySession) return;
    const nextRound = Math.min(Math.max(recoverySession.current_round, 1), 3) as 1 | 2 | 3;
    const priorScores = scoresForResume(recoverySession);

    setScores(priorScores.length > 0 ? priorScores : [recoverySession.total_score].filter(Boolean));
    setCurrentRound(nextRound);
    setAnswerError(null);
    setAnswerState(null);
    setRecoverySession(null);
    setPhase("challenge");
  };

  const handleForfeit = async () => {
    try {
      await clearOpenSession();
      setRecoverySession(null);
      setScores([]);
      setCurrentRound(1);
      setAnswerError(null);
      setAnswerState(null);
      setPhase("warmup");
      router.replace(`/challenge/${challengeId}`);
    } catch {
      toast.error("Couldn't forfeit this session. Please try again.");
    }
  };

  const handleStartNew = async () => {
    try {
      await clearOpenSession();
      setRecoverySession(null);
      setScores([]);
      setCurrentRound(1);
      setAnswerError(null);
      setAnswerState(null);
      setPhase("warmup");
    } catch {
      toast.error("Couldn't start a new session. Please try again.");
    }
  };

  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-medium text-[var(--foreground)]">{loadError}</p>
        <button
          className="rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] hover:opacity-90"
          onClick={() => {
            setLoadError(null);
            router.refresh();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (recoverySession && (recoverySession.status === "expired" || recoverySession.last_answered_round > 0)) {
    return (
      <>
        <div className="min-h-screen bg-[var(--background)]" />
        <SessionRecoveryModal
          session={toRecoveryDetails(recoverySession)}
          onResume={handleResume}
          onForfeit={handleForfeit}
          onStartNew={handleStartNew}
        />
      </>
    );
  }

  if (phase === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-[var(--muted-foreground)]">Loading challenge...</div>
      </div>
    );
  }

  if (phase === "warmup" && challenge && apiToken) {
    return (
      <WarmupPhase
        challenge={challenge}
        apiToken={apiToken}
        deviceId={visitorId ?? "unknown-device"}
        onComplete={handleWarmupComplete}
      />
    );
  }

  if (phase === "challenge" && challenge) {
    const question = questions[currentRound - 1];
    if (!question) return null;

    return (
      <div className="min-h-screen p-6 pt-16">
        <OfflineBanner blocking />
        <ChallengeRound
          question={question}
          round={currentRound}
          onAnswer={handleAnswer}
          brandLogoUrl={challenge.logo_url ?? undefined}
          answerError={answerError}
          onRetry={retryLastAnswer}
          answerState={answerState}
          disabled={!isOnline}
          pauseTimer={!isOnline}
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
