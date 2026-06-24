"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
}

function applyTheme(mode: ThemeMode) {
  const html = document.documentElement;
  const isDark = mode === "dark" || (mode === "system" && prefersDark());
  html.classList.toggle("dark", isDark);
  html.dataset.theme = mode;
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const initial = getStoredTheme();
    setMode(initial);
    applyTheme(initial);

    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = getStoredTheme();
      if (current !== "system") return;
      applyTheme("system");
    };

    media?.addEventListener?.("change", onChange);
    return () => media?.removeEventListener?.("change", onChange);
  }, []);

  const nextMode = useMemo(() => {
    if (mode === "system") return "light";
    if (mode === "light") return "dark";
    return "system";
  }, [mode]);

  const label = useMemo(() => {
    if (mode === "system") return "System";
    if (mode === "light") return "Light";
    return "Dark";
  }, [mode]);

  const onClick = () => {
    const next = nextMode;
    setMode(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  if (!mounted) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled
        aria-hidden="true"
      >
        System
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      aria-label={`Theme: ${label}. Switch to ${nextMode}.`}
      aria-pressed={mode !== "system"}
    >
      {label}
    </Button>
  );
}

