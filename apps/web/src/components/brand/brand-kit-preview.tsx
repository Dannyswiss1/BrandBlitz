"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface BrandKitPreviewProps {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tagline: string | null;
  brandName: string;
  onStart: () => void;
  onSkip: () => void;
  durationSeconds?: number;
}

function getContrastColor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#1a1a1a" : "#ffffff";
}

export function BrandKitPreview({
  logoUrl,
  primaryColor,
  secondaryColor,
  tagline,
  brandName,
  onStart,
  onSkip,
  durationSeconds = 5,
}: BrandKitPreviewProps) {
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const [logoError, setLogoError] = useState(false);
  const [started, setStarted] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bgColor = primaryColor ?? "#6366f1";
  const accentColor = secondaryColor ?? getContrastColor(bgColor);
  const textColor = getContrastColor(bgColor);
  const progress = ((durationSeconds - timeLeft) / durationSeconds) * 100;

  useEffect(() => {
    if (started) return;
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          onStart();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [started, onStart]);

  const handleSkip = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    onSkip();
  }, [onSkip]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSkip]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-500"
      style={{ backgroundColor: bgColor }}
      role="region"
      aria-label="Brand introduction"
    >
      <div className="flex flex-col items-center gap-6 px-6 max-w-md w-full">
        {/* Logo */}
        <div
          className="flex items-center justify-center rounded-2xl"
          style={{
            width: 120,
            height: 120,
            backgroundColor: accentColor,
          }}
        >
          {logoUrl && !logoError ? (
            <img
              src={logoUrl}
              alt={`${brandName} logo`}
              width={120}
              height={120}
              className="object-contain rounded-2xl"
              onError={() => setLogoError(true)}
            />
          ) : (
            <span
              className="text-5xl font-bold select-none"
              style={{ color: textColor }}
              aria-hidden="true"
            >
              {brandName.charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        {/* Brand name */}
        <h1
          className="text-3xl font-bold text-center"
          style={{ color: textColor }}
        >
          {brandName}
        </h1>

        {/* Tagline */}
        {tagline && (
          <p
            className="text-lg text-center opacity-90"
            style={{ color: textColor }}
          >
            {tagline}
          </p>
        )}

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${textColor}33` }}>
          <div
            className="h-full rounded-full transition-all duration-1000 ease-linear"
            style={{
              width: `${progress}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>

        {/* Start / Skip buttons */}
        <div className="flex gap-4 mt-4">
          <button
            onClick={handleSkip}
            className="px-8 py-3 rounded-xl text-base font-semibold transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{
              backgroundColor: textColor,
              color: bgColor,
              ringColor: textColor,
            }}
            aria-label="Skip brand introduction"
          >
            Start Now
          </button>
        </div>

        <p
          className="text-sm opacity-70"
          style={{ color: textColor }}
        >
          or press Space to skip
        </p>
      </div>
    </div>
  );
}
