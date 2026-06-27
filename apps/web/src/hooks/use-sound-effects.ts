"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "brandblitz_sounds_enabled";

function getStoredPreference(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "true";
}

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", rampTo?: number) {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    if (rampTo !== undefined) {
      oscillator.frequency.linearRampToValueAtTime(rampTo, ctx.currentTime + duration);
    }

    gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // Audio context may be blocked or unavailable
  }
}

function playCorrect() {
  // Ascending two-tone chime: high then higher
  playTone(523, 0.12, "sine", 523); // C5
  setTimeout(() => playTone(659, 0.15, "sine", 659), 80); // E5
}

function playWrong() {
  // Low descending buzz
  playTone(200, 0.25, "sawtooth", 120);
}

function playTick() {
  // Short high click
  playTone(800, 0.05, "square");
}

export function useSoundEffects() {
  const [enabled, setEnabled] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    setEnabled(getStoredPreference());
    return () => { mountedRef.current = false; };
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (mountedRef.current) {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      }
      return next;
    });
  }, []);

  const correct = useCallback(() => {
    if (enabled) playCorrect();
  }, [enabled]);

  const wrong = useCallback(() => {
    if (enabled) playWrong();
  }, [enabled]);

  const tick = useCallback(() => {
    if (enabled) playTick();
  }, [enabled]);

  return { enabled, toggle, correct, wrong, tick };
}
