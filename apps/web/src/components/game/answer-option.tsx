"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AnswerOptionKey = "A" | "B" | "C" | "D";

interface AnswerOptionProps {
  option: AnswerOptionKey;
  label: string;
  selected?: boolean;
  pending?: boolean;
  correct?: boolean | null;
  disabled?: boolean;
  onSelect: (option: AnswerOptionKey) => void;
}

export function AnswerOption({
  option,
  label,
  selected = false,
  pending = false,
  correct = null,
  disabled = false,
  onSelect,
}: AnswerOptionProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      disabled={disabled}
      className={cn(
        "w-full justify-start px-4 py-3 text-left h-[54px] transition-all",
        selected && pending && "ring-2 ring-[var(--primary)] bg-[var(--accent)]",
        selected && correct === true && "border-green-600 bg-green-50 text-green-900 ring-2 ring-green-600",
        selected && correct === false && "border-red-600 bg-red-50 text-red-900 ring-2 ring-red-600",
      )}
      onClick={() => onSelect(option)}
      aria-label={`${option}: ${label}`}
      aria-pressed={selected}
    >
      <kbd className="mr-3 inline-flex h-6 min-w-6 items-center justify-center rounded border border-[var(--border)] bg-[var(--muted)] px-1 font-bold text-[var(--muted-foreground)] max-md:hidden" aria-hidden="true">
        {option}
      </kbd>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Submitting answer" /> : null}
    </Button>
  );
}
