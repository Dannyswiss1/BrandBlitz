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
  paused?: boolean;
}

export function useCountdown({ durationSeconds, deadlineAt, onExpire, paused = false }: UseCountdownOptions) {
  const [timeLeftMs, setTimeLeftMs] = useState(durationSeconds * 1000);
  const onExpireRef = useRef(onExpire);
  const pausedRef = useRef(paused);
  onExpireRef.current = onExpire;
  pausedRef.current = paused;

  useEffect(() => {
    const totalMs = durationSeconds * 1000;
    setTimeLeftMs(totalMs);
    let remainingMs = deadlineAt != null ? Math.max(0, deadlineAt - Date.now()) : totalMs;
    let lastTickAt = Date.now();
    let expired = false;
    let hidden = typeof document !== "undefined" && document.visibilityState === "hidden";

    function readRemaining(): number {
      if (deadlineAt != null) {
        return Math.max(0, deadlineAt - Date.now());
      }
      return remainingMs;
    }

    function tick() {
      const now = Date.now();

      if (!pausedRef.current && !hidden && deadlineAt == null) {
        remainingMs = Math.max(0, remainingMs - (now - lastTickAt));
      }

      lastTickAt = now;
      const remaining = deadlineAt != null && !pausedRef.current && !hidden
        ? Math.max(0, deadlineAt - now)
        : readRemaining();

      setTimeLeftMs(remaining);
      if (remaining === 0 && !expired) {
        expired = true;
        onExpireRef.current?.();
      }
    }

    const intervalId = setInterval(tick, 100);

    // Pause the countdown when the tab is hidden to prevent background timing
    // from advancing the displayed counter without the user seeing it. Deadline
    // based timers still re-sync when visible and online again.
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hidden = true;
      } else {
        hidden = false;
        lastTickAt = Date.now();
        tick();
      }
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [durationSeconds, deadlineAt]);

  return { timeLeftMs };
}
