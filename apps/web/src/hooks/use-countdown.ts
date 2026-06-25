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
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const totalMs = durationSeconds * 1000;
    setTimeLeftMs(totalMs);

    // Derive start time from the server deadline when available so that the
    // client clock is anchored to the authoritative deadline, not to when the
    // component mounted.
    let startTime = deadlineAt != null ? Date.now() - (totalMs - (deadlineAt - Date.now())) : Date.now();

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    let hiddenAt: number | null = hidden ? Date.now() : null;

    function getRemaining(): number {
      if (deadlineAt != null) {
        return Math.max(0, deadlineAt - Date.now());
      }
      const elapsed = Date.now() - startTime;
      return Math.max(0, totalMs - elapsed);
    }

    function tick() {
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

    // Pause the countdown when the tab is hidden to prevent background timing
    // from advancing the displayed counter without the user seeing it.
    // On restore, re-sync against the server deadline (or current elapsed time)
    // so any real time that passed is accounted for correctly (#346).
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hidden = true;
        hiddenAt = Date.now();
        stopInterval();
      } else {
        hidden = false;
        if (deadlineAt == null && hiddenAt != null) {
          startTime += Date.now() - hiddenAt;
        }
        hiddenAt = null;
        // Re-sync immediately on restore so the displayed time jumps to the
        // correct value before the next interval tick.
        tick();
        if (getRemaining() > 0) {
          startInterval();
        }
      }
    }

    if (!hidden) {
      startInterval();
    }

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      stopInterval();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [durationSeconds, deadlineAt]);

  return { timeLeftMs };
}
