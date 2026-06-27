"use client";

import { useEffect, useRef } from "react";
import type { AnswerOptionKey } from "@/components/game/answer-option";

interface UseKeyboardAnswersOptions {
  onAnswer: (option: AnswerOptionKey) => void;
  disabled?: boolean;
}

export function useKeyboardAnswers({ onAnswer, disabled = false }: UseKeyboardAnswersOptions) {
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;

  useEffect(() => {
    if (disabled) return;

    const keyToOption: Record<string, AnswerOptionKey | undefined> = {
      a: "A",
      b: "B",
      c: "C",
      d: "D",
      1: "A",
      2: "B",
      3: "C",
      4: "D",
    };

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      const option = keyToOption[event.key.toLowerCase()];
      if (!option) return;

      event.preventDefault();
      onAnswerRef.current(option);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disabled]);
}
