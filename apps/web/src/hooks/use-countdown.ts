"use client";

import { useState, useEffect, useRef } from "react";

interface UseCountdownOptions {
  durationSeconds: number;
  /**
   * Optional server-authoritative deadline (Unix timestamp in ms).
   * When provided, the remaining time is recalculated from the deadline on
   * tab-focus restore instead of resuming from stale client-side state (#346).
   */
  deadlineAt?: number;
  onExpire?: () => void;
}

export function useCountdown({ durationSeconds, deadlineAt, onExpire }: UseCountdownOptions) {
  const [timeLeftMs, setTimeLeftMs] = useState(durationSeconds * 1000);
  const [isPaused, setIsPaused] = useState(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const totalMs = durationSeconds * 1000;
    setTimeLeftMs(totalMs);
    setIsPaused(false);

    const startTime = deadlineAt != null ? Date.now() - (totalMs - (deadlineAt - Date.now())) : Date.now();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let paused = false;

    function getRemaining(): number {
      if (deadlineAt != null) {
        return Math.max(0, deadlineAt - Date.now());
      }
      const elapsed = Date.now() - startTime;
      return Math.max(0, totalMs - elapsed);
    }

    function tick() {
      if (paused) return;
      const remaining = getRemaining();
      setTimeLeftMs(remaining);
      if (remaining === 0) {
        if (intervalId != null) clearInterval(intervalId);
        intervalId = null;
        onExpireRef.current?.();
      }
    }

    function startInterval() {
      if (intervalId != null) return;
      intervalId = setInterval(tick, 100);
    }

    function stopInterval() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    function pause() {
      if (paused) return;
      paused = true;
      setIsPaused(true);
      stopInterval();
    }

    function resume() {
      if (!paused) return;
      paused = false;
      setIsPaused(false);
      tick();
      if (getRemaining() > 0) {
        startInterval();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        pause();
      } else {
        resume();
      }
    }

    function handleBlur() {
      pause();
    }

    function handleFocus() {
      resume();
    }

    if (typeof document !== "undefined" && document.visibilityState !== "hidden") {
      startInterval();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("blur", handleBlur);
      window.addEventListener("focus", handleFocus);
    }

    return () => {
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("blur", handleBlur);
        window.removeEventListener("focus", handleFocus);
      }
    };
  }, [durationSeconds, deadlineAt]);

  return { timeLeftMs, isPaused };
}
