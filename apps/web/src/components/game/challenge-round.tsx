"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CountdownTimer } from "./countdown-timer";
import { cn } from "@/lib/utils";
import { ROUND_SECONDS } from "./constants";
import type { ChallengeQuestion } from "@/lib/api";

interface ChallengeRoundProps {
  question: ChallengeQuestion;
  round: 1 | 2 | 3;
  onAnswer: (option: "A" | "B" | "C" | "D" | null, reactionTimeMs: number) => void;
  brandLogoUrl?: string;
  brandProductImageUrl?: string;
  /** #154 — inline error banner when the parent's answer submission
   *  fails after retries. Null / undefined = no error. */
  answerError?: string | null;
  /** #154 — replay the last submitted answer with fresh network
   *  calls. The parent owns the retry payload; the component just
   *  wires the click. */
  onRetry?: () => void;
}

const OPTIONS: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];

export function ChallengeRound({
  question,
  round,
  onAnswer,
  brandLogoUrl,
  brandProductImageUrl,
  answerError = null,
  onRetry,
}: ChallengeRoundProps) {
  const [selected, setSelected] = useState<"A" | "B" | "C" | "D" | null>(null);
  const [answered, setAnswered] = useState(false);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    startTimeRef.current = Date.now();
    setSelected(null);
    setAnswered(false);
  }, [round]);

  const handleSelect = useCallback((option: "A" | "B" | "C" | "D") => {
    if (answered) return;
    const reactionTimeMs = Date.now() - startTimeRef.current;
    setSelected(option);
    setAnswered(true);
    onAnswer(option, reactionTimeMs);
  }, [answered, onAnswer]);

  useEffect(() => {
    if (answered) return;

    const keyToOption: Record<string, "A" | "B" | "C" | "D" | undefined> = {
      a: "A",
      b: "B",
      c: "C",
      d: "D",
      1: "A",
      2: "B",
      3: "C",
      4: "D",
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      const opt = keyToOption[event.key.toLowerCase()];
      if (!opt) return;

      event.preventDefault();
      handleSelect(opt);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [answered, handleSelect]);

  const handleTimeExpire = () => {
    if (!answered) {
      const reactionTimeMs = ROUND_SECONDS * 1000;
      setAnswered(true);
      onAnswer(null, reactionTimeMs);
    }
  };

  const getOptionLabel = (opt: "A" | "B" | "C" | "D") => {
    const map = { A: question.option_a, B: question.option_b, C: question.option_c, D: question.option_d };
    return map[opt];
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      {/* Round indicator */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--muted-foreground)]">
          Round {round} of 3
        </span>
        <CountdownTimer
          durationSeconds={ROUND_SECONDS}
          onExpire={handleTimeExpire}
          className="w-32"
        />
      </div>

      {/* Prompt image */}
      {(question.prompt_type === "logo" && brandLogoUrl) && (
        <div className="flex justify-center py-4">
          <Image
            src={brandLogoUrl}
            alt="Brand prompt"
            width={320}
            height={96}
            sizes="320px"
            className="h-24 w-auto object-contain"
          />
        </div>
      )}
      {(question.prompt_type === "productImage1" && brandProductImageUrl) && (
        <div className="flex justify-center py-4">
          <Image
            src={brandProductImageUrl}
            alt="Product prompt"
            width={480}
            height={320}
            sizes="480px"
            className="h-40 w-auto rounded-lg object-contain"
          />
        </div>
      )}

      {/* Question text */}
      <p className="text-xl font-semibold text-center">{question.question_text}</p>

      {/* Answer options */}
      <div className="grid grid-cols-1 gap-3">
        {OPTIONS.map((opt) => (
          <Button
            key={opt}
            variant="outline"
            size="lg"
            className={cn(
              "w-full text-left justify-start h-auto py-3 px-4 transition-all",
              selected === opt && "ring-2 ring-[var(--primary)] bg-[var(--accent)]",
              answered && "pointer-events-none"
            )}
            onClick={() => handleSelect(opt)}
            aria-label={`${opt}: ${getOptionLabel(opt)}`}
          >
            <kbd className="font-bold mr-3 text-[var(--muted-foreground)] inline-flex items-center justify-center min-w-6 h-6 px-1 rounded border border-[var(--border)] bg-[var(--muted)]">
              {opt}
            </kbd>
            <span>{getOptionLabel(opt)}</span>
          </Button>
        ))}
      </div>

      {/* #154 — Answer submission error banner with retry. */}
      {answerError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-500/50 bg-red-500/10 p-4 text-sm"
        >
          <p className="text-red-500">Failed to submit answer: {answerError}</p>
          {onRetry && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={onRetry}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
