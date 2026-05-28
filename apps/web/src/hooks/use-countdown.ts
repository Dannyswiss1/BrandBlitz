"use client";

import { useState, useEffect, useRef } from "react";

interface UseCountdownOptions {
  durationSeconds: number;
  onExpire?: () => void;
}

export function useCountdown({ durationSeconds, onExpire }: UseCountdownOptions) {
  const [timeLeftMs, setTimeLeftMs] = useState(durationSeconds * 1000);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    const totalMs = durationSeconds * 1000;
    setTimeLeftMs(totalMs);
    const startTime = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, totalMs - elapsed);
      setTimeLeftMs(remaining);
      if (remaining === 0) {
        clearInterval(interval);
        onExpireRef.current?.();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [durationSeconds]);

  return { timeLeftMs };
}
