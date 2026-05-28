"use client";

import { useState, useEffect } from "react";
import { createApiClient, type Challenge, type ChallengeQuestion } from "@/lib/api";

export interface ChallengeError {
  message: string;
  code?: string;
}

interface UseChallengeResult {
  challenge: Challenge | null;
  questions: ChallengeQuestion[];
  loading: boolean;
  error: ChallengeError | null;
}

export function useChallenge(challengeId: string, apiToken?: string): UseChallengeResult {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [questions, setQuestions] = useState<ChallengeQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ChallengeError | null>(null);

  useEffect(() => {
    if (!challengeId) return;

    const api = createApiClient(apiToken);

    api
      .get(`/challenges/${challengeId}`)
      .then((res) => {
        setChallenge(res.data.challenge);
        setQuestions(res.data.questions ?? []);
      })
      .catch((err) => {
        if (!err.response) {
          setError({ message: "Couldn't reach the server" });
        } else {
          setError({
            message: err.response.data?.error?.message ?? "Failed to load challenge",
            code: err.response.data?.error?.code,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [challengeId, apiToken]);

  return { challenge, questions, loading, error };
}
